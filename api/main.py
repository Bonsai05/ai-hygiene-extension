"""
AI Hygiene Companion backend.
Lightweight models load at startup; heavy model loads on demand.
"""

from __future__ import annotations

import threading
import time
from enum import Enum
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from transformers import pipeline
except Exception:  # pragma: no cover - runtime environment fallback
    pipeline = None  # type: ignore[assignment]

PROVIDER_NAME = "DmlExecutionProvider/CPU"

LIGHTWEIGHT_MODELS: dict[str, dict[str, str]] = {
    "url_phishing": {"id": "pirocheto/phishing-url-detection", "task": "text-classification"},
    "scam_llm": {"id": "mrm8488/bert-tiny-finetuned-sms-spam-detection", "task": "text-classification"},
    "bert_phishing": {"id": "ealvaradob/bert-base-uncased-ft-phishing-urls", "task": "text-classification"},
    "pii_detection": {"id": "dslim/bert-base-NER", "task": "token-classification"},
}

HEAVY_MODELS = {
    "Qwen/Qwen2.5-1.5B-Instruct",
    "microsoft/Phi-4-mini-instruct",
    "google/gemma-2-2b-it",
}

model_state_lock = threading.Lock()
model_state: dict[str, str] = {k: "loading" for k in LIGHTWEIGHT_MODELS}
model_errors: dict[str, str] = {}
lightweight_pipelines: dict[str, Any] = {}
heavy_pipeline: Any = None
heavy_model_id: Optional[str] = None
heavy_status = {"status": "idle", "progress": 0}


def _is_malicious(label: str) -> bool:
    label = label.lower()
    return any(token in label for token in ["phish", "scam", "fraud", "malware", "label_1", "unsafe", "spam"])


def _risk_from_prediction(label: str, score: float) -> tuple[str, int]:
    if _is_malicious(label):
        if score >= 0.72:
            return "danger", int(score * 100)
        return "warning", int(score * 100)
    if score < 0.55:
        return "warning", int((1 - score) * 100)
    return "safe", int((1 - score) * 25)


def _load_lightweight_models() -> None:
    if pipeline is None:
        for key in LIGHTWEIGHT_MODELS:
            with model_state_lock:
                model_state[key] = "failed"
                model_errors[key] = "transformers_not_installed"
        return
    for key, config in LIGHTWEIGHT_MODELS.items():
        try:
            with model_state_lock:
                model_state[key] = "loading"
            lightweight_pipelines[key] = pipeline(config["task"], model=config["id"], device=-1)
            with model_state_lock:
                model_state[key] = "ready"
                model_errors.pop(key, None)
        except Exception as exc:  # pragma: no cover - defensive runtime handling
            with model_state_lock:
                model_state[key] = "failed"
                model_errors[key] = str(exc)


def _load_heavy_model(model_id: str) -> None:
    global heavy_pipeline, heavy_model_id
    if pipeline is None:
        with model_state_lock:
            heavy_status["status"] = "failed"
            heavy_status["progress"] = 0
        return
    try:
        with model_state_lock:
            heavy_status["status"] = "downloading"
            heavy_status["progress"] = 10
        time.sleep(0.3)
        with model_state_lock:
            heavy_status["status"] = "loading"
            heavy_status["progress"] = 50
        heavy_pipeline = pipeline("text-generation", model=model_id, device=-1)
        heavy_model_id = model_id
        with model_state_lock:
            heavy_status["status"] = "ready"
            heavy_status["progress"] = 100
    except Exception:  # pragma: no cover - defensive runtime handling
        with model_state_lock:
            heavy_status["status"] = "failed"
            heavy_status["progress"] = 0


class RiskLevel(str, Enum):
    SAFE = "safe"
    WARNING = "warning"
    DANGER = "danger"


class URLAnalysisRequest(BaseModel):
    url: str


class TextAnalysisRequest(BaseModel):
    text: str
    url: Optional[str] = None


class HeavyLoadRequest(BaseModel):
    model_id: str


class HeavyAnalyzeRequest(BaseModel):
    text: str
    url: Optional[str] = None


class RiskAnalysisResponse(BaseModel):
    level: RiskLevel
    score: int
    patterns: list[str]
    reason: str
    provider: str


app = FastAPI(title="AI Hygiene Companion Backend", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup_event() -> None:
    threading.Thread(target=_load_lightweight_models, daemon=True).start()


@app.get("/health")
async def health() -> dict[str, Any]:
    with model_state_lock:
        heavy_block: Optional[dict[str, str]] = None
        if heavy_model_id:
            heavy_block = {"id": heavy_model_id, "status": heavy_status["status"]}
        return {
            "status": "ok",
            "provider": PROVIDER_NAME,
            "models": dict(model_state),
            "model_errors": dict(model_errors),
            "heavy_model": heavy_block,
            "heavy_progress": heavy_status["progress"],
        }


@app.post("/analyze/url", response_model=RiskAnalysisResponse)
async def analyze_url(body: URLAnalysisRequest) -> RiskAnalysisResponse:
    if not body.url.strip():
        raise HTTPException(status_code=400, detail="url cannot be empty")
    model = lightweight_pipelines.get("url_phishing")
    if model is None:
        # Fallback heuristic when model is unavailable.
        lower = body.url.lower()
        suspicious = any(token in lower for token in ["@", "login-", "verify", "secure-update", ".tk", ".xyz"])
        return RiskAnalysisResponse(
            level=RiskLevel.DANGER if suspicious else RiskLevel.SAFE,
            score=85 if suspicious else 5,
            patterns=["heuristic_fallback"] if suspicious else [],
            reason="Heuristic fallback used because URL model is unavailable.",
            provider="Heuristic fallback",
        )

    res = model(body.url.strip(), truncation=True, max_length=512)[0]
    level, score = _risk_from_prediction(res.get("label", "safe"), float(res.get("score", 0)))
    return RiskAnalysisResponse(
        level=RiskLevel(level),
        score=score,
        patterns=[] if level == "safe" else ["backend_url_model"],
        reason=f"URL model classified as {res.get('label', 'unknown')}.",
        provider=PROVIDER_NAME,
    )


@app.post("/analyze/text", response_model=RiskAnalysisResponse)
async def analyze_text(body: TextAnalysisRequest) -> RiskAnalysisResponse:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")
    model = lightweight_pipelines.get("scam_llm")
    if model is None:
        lower = body.text.lower()
        suspicious = any(token in lower for token in ["verify your account", "urgent action", "reset password", "bank alert"])
        return RiskAnalysisResponse(
            level=RiskLevel.WARNING if suspicious else RiskLevel.SAFE,
            score=65 if suspicious else 5,
            patterns=["heuristic_text_fallback"] if suspicious else [],
            reason="Heuristic fallback used because text model is unavailable.",
            provider="Heuristic fallback",
        )

    res = model(body.text.strip(), truncation=True, max_length=512)[0]
    level, score = _risk_from_prediction(res.get("label", "safe"), float(res.get("score", 0)))
    return RiskAnalysisResponse(
        level=RiskLevel(level),
        score=score,
        patterns=[] if level == "safe" else ["backend_text_model"],
        reason=f"Text model classified as {res.get('label', 'unknown')}.",
        provider=PROVIDER_NAME,
    )


@app.post("/heavy/load")
async def heavy_load(body: HeavyLoadRequest) -> dict[str, Any]:
    if body.model_id not in HEAVY_MODELS:
        raise HTTPException(status_code=400, detail="unsupported_model")
    with model_state_lock:
        if heavy_status["status"] in {"downloading", "loading"}:
            return {"ok": True, "status": heavy_status["status"], "progress": heavy_status["progress"]}
    threading.Thread(target=_load_heavy_model, args=(body.model_id,), daemon=True).start()
    return {"ok": True, "status": "downloading", "progress": 0}


@app.post("/heavy/status")
async def heavy_status_endpoint() -> dict[str, Any]:
    with model_state_lock:
        return {
            "loaded": heavy_status["status"] == "ready",
            "model_id": heavy_model_id,
            "status": heavy_status["status"],
            "progress": heavy_status["progress"],
        }


@app.post("/heavy/analyze")
async def heavy_analyze(body: HeavyAnalyzeRequest) -> dict[str, Any]:
    if heavy_pipeline is None:
        raise HTTPException(status_code=503, detail={"error": "model_not_ready", "model": "heavy"})
    prompt = f"Analyze this website content for phishing risk:\n{body.text[:1500]}"
    output = heavy_pipeline(prompt, max_new_tokens=120, do_sample=False)
    text = output[0].get("generated_text", "")
    return {"threat_level": "analyze_output", "explanation": text, "recommendations": ["Avoid entering credentials until verified."]}


@app.post("/heavy/unload")
async def heavy_unload() -> dict[str, Any]:
    global heavy_pipeline, heavy_model_id
    heavy_pipeline = None
    heavy_model_id = None
    with model_state_lock:
        heavy_status["status"] = "idle"
        heavy_status["progress"] = 0
    return {"ok": True}

