"""
ai-hygiene-extension — FastAPI Backend
======================================
Tier 1 (always-on): 7 lightweight models loaded at startup via ONNX Runtime + DirectML
Tier 2 (on-demand):  Heavy generative LLM loaded only when user enables the Settings toggle

Usage:
    python main.py                     # starts on http://127.0.0.1:8000
    python main.py --host 0.0.0.0     # if needed
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ai-hygiene")

# ---------------------------------------------------------------------------
# Model registry — order determines load sequence
# ---------------------------------------------------------------------------
LIGHTWEIGHT_MODELS: List[Dict[str, Any]] = [
    {
        "key": "url_phishing",
        "id": "ealvaradob/phishing-url-detection",
        "task": "text-classification",
        "size": "30 MB",
        "use_ort": True,
        "description": "URL lexical phishing detection (ONNX)",
    },
    {
        "key": "scam_llm",
        "id": "phishbot/ScamLLM",
        "task": "text-classification",
        "size": "66 MB",
        "use_ort": False,   # No ONNX export available — runs via PyTorch CPU
        "description": "Social engineering / scam content (RoBERTa)",
    },
    {
        "key": "bert_phishing",
        "id": "onnx-community/bert-finetuned-phishing-ONNX",
        "task": "text-classification",
        "size": "68 MB",
        "use_ort": True,
        "description": "BERT credential-harvesting detector (ONNX)",
    },
    {
        "key": "pii_detection",
        "id": "gravitee-io/bert-small-pii-detection",
        "task": "token-classification",
        "size": "45 MB",
        "use_ort": True,
        "description": "PII entity detection in DOM text (ONNX)",
    },
    {
        "key": "bert_phishing_v2",
        "id": "ealvaradob/bert-base-uncased-ft-phishing-urls",
        "task": "text-classification",
        "size": "110 MB",
        "use_ort": True,
        "description": "BERT phishing URL v2 (ONNX, redundancy)",
    },
    {
        "key": "email_phishing",
        "id": "cybersectony/phishing-email-detection-distilbert_v2.4.1",
        "task": "text-classification",
        "size": "65 MB",
        "use_ort": True,
        "description": "Email-style phishing content (DistilBERT ONNX)",
    },
    {
        "key": "spam_detection",
        "id": "mrm8488/bert-tiny-finetuned-sms-spam-detection",
        "task": "text-classification",
        "size": "17 MB",
        "use_ort": True,
        "description": "SMS spam / smishing signal (TinyBERT ONNX)",
    },
]

HEAVY_MODELS: Dict[str, str] = {
    "Qwen/Qwen2.5-1.5B-Instruct":   "~1 GB — Recommended",
    "microsoft/Phi-4-mini-instruct": "~2.5 GB",
    "google/gemma-4-it":             "~3 GB",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B": "~1 GB",
}

ENSEMBLE_WEIGHTS: Dict[str, float] = {
    "url_phishing":    0.25,
    "bert_phishing":   0.20,
    "bert_phishing_v2": 0.15,
    "scam_llm":        0.20,
    "email_phishing":  0.15,
    "spam_detection":  0.05,
    # pii_detection is intentionally excluded from risk score blend
}

# ---------------------------------------------------------------------------
# Runtime state
# ---------------------------------------------------------------------------
_model_pipes: Dict[str, Any] = {}   # key → pipeline/model tuple
_model_status: Dict[str, str] = {m["key"]: "loading" for m in LIGHTWEIGHT_MODELS}
_active_provider: str = "CPUExecutionProvider"
_inference_counter: int = 0         # for NPU monitor load bar

_heavy_model: Any = None
_heavy_model_id: Optional[str] = None
_heavy_status: str = "unloaded"     # unloaded | downloading | loading | ready | failed
_heavy_progress: int = 0

# ---------------------------------------------------------------------------
# NPU / DirectML helpers
# ---------------------------------------------------------------------------
def get_ort_providers() -> List[str]:
    """Return the best available ONNX Runtime execution providers."""
    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider", "CPUExecutionProvider"]
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    except Exception:
        pass
    return ["CPUExecutionProvider"]

# ---------------------------------------------------------------------------
# NPU Terminal Monitor (runs in daemon thread)
# Prints a live ASCII load bar to stderr showing inference activity
# ---------------------------------------------------------------------------
_stop_monitor = threading.Event()

def _npu_monitor_thread():
    """Displays a live ASCII bar in the terminal showing inference load."""
    COLORS = {
        "DmlExecutionProvider":  "\033[95m",  # magenta (AMD NPU)
        "CUDAExecutionProvider": "\033[92m",  # green   (NVIDIA GPU)
        "CPUExecutionProvider":  "\033[94m",  # blue    (CPU)
    }
    RESET = "\033[0m"
    prev_counter = 0
    load_pct = 0

    while not _stop_monitor.is_set():
        delta = _inference_counter - prev_counter
        prev_counter = _inference_counter
        # Smooth decay
        target = min(100, delta * 35)
        load_pct = int(load_pct * 0.6 + target * 0.4)
        fill = int(load_pct / 5)
        bar = "█" * fill + "─" * (20 - fill)
        color = COLORS.get(_active_provider, "")
        provider_short = _active_provider.replace("ExecutionProvider", "")
        n_ready = sum(1 for s in _model_status.values() if s == "ready")
        heavy_str = f" | 🔥 {_heavy_model_id}" if _heavy_status == "ready" and _heavy_model_id else ""
        sys.stderr.write(
            f"\r{color}🧠 AI Hygiene Backend{RESET} | "
            f"[{bar}] {load_pct:3d}% | EP: {provider_short} | "
            f"Models: {n_ready}/{len(LIGHTWEIGHT_MODELS)}{heavy_str}   "
        )
        sys.stderr.flush()
        time.sleep(0.5)
    sys.stderr.write("\n")

# ---------------------------------------------------------------------------
# Model loading — runs sequentially in a background thread at startup
# ---------------------------------------------------------------------------
def _load_model(meta: Dict[str, Any]) -> None:
    """Load a single model and store its pipeline in _model_pipes."""
    global _active_provider
    key = meta["key"]
    model_id = meta["id"]
    use_ort = meta["use_ort"]

    try:
        _model_status[key] = "loading"
        log.info(f"Loading {key}: {model_id} (ORT={use_ort})")

        if use_ort:
            # ONNX Runtime via optimum
            from optimum.onnxruntime import (
                ORTModelForSequenceClassification,
                ORTModelForTokenClassification,
            )
            from transformers import AutoTokenizer

            providers = get_ort_providers()
            if providers[0] != "CPUExecutionProvider" and "DmlExecutionProvider" in providers:
                _active_provider = "DmlExecutionProvider"
            elif "CUDAExecutionProvider" in providers:
                _active_provider = "CUDAExecutionProvider"

            tokenizer = AutoTokenizer.from_pretrained(model_id)
            ort_kwargs = {"providers": providers}

            if meta["task"] == "token-classification":
                model = ORTModelForTokenClassification.from_pretrained(
                    model_id, export=True, **ort_kwargs
                )
            else:
                model = ORTModelForSequenceClassification.from_pretrained(
                    model_id, export=True, **ort_kwargs
                )

            from transformers import pipeline as hf_pipeline
            pipe = hf_pipeline(
                meta["task"],
                model=model,
                tokenizer=tokenizer,
                device=-1,
            )
        else:
            # Pure PyTorch (ScamLLM — no ONNX export)
            from transformers import pipeline as hf_pipeline
            pipe = hf_pipeline(
                meta["task"],
                model=model_id,
                device=-1,         # CPU
                torch_dtype="auto",
            )

        _model_pipes[key] = pipe
        _model_status[key] = "ready"
        log.info(f"✅ {key} ready")

    except Exception as exc:
        _model_status[key] = "failed"
        log.error(f"❌ {key} failed to load: {exc}")


def _load_all_models():
    for meta in LIGHTWEIGHT_MODELS:
        _load_model(meta)
    log.info("All lightweight models loaded (or attempted).")


# ---------------------------------------------------------------------------
# Inference helpers
# ---------------------------------------------------------------------------
def _infer_phishing(pipe: Any, text: str) -> float:
    """Run a text-classification pipe and return phishing/spam probability (0.0–1.0)."""
    global _inference_counter
    try:
        result = pipe(text[:512], truncation=True)
        _inference_counter += 1
        if isinstance(result, list) and result:
            item = result[0]
            label = str(item.get("label", "")).upper()
            score = float(item.get("score", 0.0))
            # Positive labels for phishing/scam/spam
            if any(k in label for k in ("PHISH", "SCAM", "SPAM", "1", "MALICIOUS", "FRAUD")):
                return score
            # Negative labels — invert
            return 1.0 - score
    except Exception as exc:
        log.debug(f"Inference error: {exc}")
    return 0.0


def _infer_pii(pipe: Any, text: str) -> List[Dict[str, Any]]:
    """Run token-classification and return PII entities."""
    global _inference_counter
    try:
        entities = pipe(text[:512], truncation=True, aggregation_strategy="simple")
        _inference_counter += 1
        return [{"entity": e["entity_group"], "word": e["word"], "score": round(float(e["score"]), 3)} for e in entities]
    except Exception:
        return []


def _ensemble_score(url: str, text: str) -> Dict[str, Any]:
    """Combine all lightweight models into a weighted phishing score."""
    individual: Dict[str, float] = {}
    total_weight = 0.0
    weighted_sum = 0.0
    auto_danger = False

    for key, weight in ENSEMBLE_WEIGHTS.items():
        pipe = _model_pipes.get(key)
        if pipe is None or _model_status.get(key) != "ready":
            continue
        # URL models get the URL; content models get the page text
        inp = text if key in ("scam_llm", "email_phishing", "spam_detection") else url
        if not inp:
            inp = url
        prob = _infer_phishing(pipe, inp)
        individual[key] = round(prob, 4)
        weighted_sum += weight * prob
        total_weight += weight
        if prob >= 0.90:
            auto_danger = True

    final = (weighted_sum / total_weight) if total_weight > 0 else 0.0

    if auto_danger or final >= 0.70:
        level = "danger"
    elif final >= 0.35:
        level = "warning"
    else:
        level = "safe"

    return {
        "level": level,
        "score": round(final * 100),   # 0-100 integer
        "individual": individual,
        "models_used": list(individual.keys()),
    }


# ---------------------------------------------------------------------------
# Lifespan — starts background model loading + NPU monitor
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start NPU monitor thread
    mon = threading.Thread(target=_npu_monitor_thread, daemon=True)
    mon.start()
    # Start model loading in background (server accepts requests immediately)
    loader = threading.Thread(target=_load_all_models, daemon=True)
    loader.start()
    log.info("🚀 AI Hygiene Backend starting — models are loading in background…")
    yield
    _stop_monitor.set()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AI Hygiene Backend",
    description="Local ML inference server for the AI Hygiene browser extension.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class UrlRequest(BaseModel):
    url: str

class TextRequest(BaseModel):
    text: str
    url: str = ""

class EnsembleRequest(BaseModel):
    url: str = ""
    text: str = ""

class HeavyLoadRequest(BaseModel):
    model_id: str = "Qwen/Qwen2.5-1.5B-Instruct"

class HeavyAnalyzeRequest(BaseModel):
    url: str = ""
    text: str = ""
    context: str = ""

# ---------------------------------------------------------------------------
# Routes — Health
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "provider": _active_provider,
        "models": _model_status,
        "heavy_model": {
            "id": _heavy_model_id,
            "status": _heavy_status,
            "progress": _heavy_progress,
        } if _heavy_model_id else None,
    }

# ---------------------------------------------------------------------------
# Routes — Lightweight Analysis (always available)
# ---------------------------------------------------------------------------
@app.post("/analyze/url")
async def analyze_url(req: UrlRequest):
    """URL-only phishing detection using URL phishing models."""
    pipe = _model_pipes.get("url_phishing")
    if not pipe or _model_status.get("url_phishing") != "ready":
        raise HTTPException(503, detail={"error": "model_not_ready", "model": "url_phishing"})

    prob = _infer_phishing(pipe, req.url)
    level = "danger" if prob >= 0.70 else "warning" if prob >= 0.35 else "safe"
    return {
        "level": level,
        "score": round(prob * 100),
        "signals": ["url_phishing_model"],
        "provider": _active_provider,
    }


@app.post("/analyze/text")
async def analyze_text(req: TextRequest):
    """Text content analysis using ScamLLM + email phishing + BERT phishing."""
    results = {}
    for key in ("scam_llm", "email_phishing", "bert_phishing"):
        pipe = _model_pipes.get(key)
        if pipe and _model_status.get(key) == "ready":
            inp = req.text or req.url
            results[key] = _infer_phishing(pipe, inp) if inp else 0.0

    if not results:
        raise HTTPException(503, detail={"error": "model_not_ready", "model": "scam_llm"})

    avg = sum(results.values()) / len(results)
    level = "danger" if avg >= 0.70 else "warning" if avg >= 0.35 else "safe"
    return {
        "level": level,
        "score": round(avg * 100),
        "individual": {k: round(v, 4) for k, v in results.items()},
        "provider": _active_provider,
    }


@app.post("/analyze/pii")
async def analyze_pii(req: TextRequest):
    """PII entity detection in text (form field content, DOM text)."""
    pipe = _model_pipes.get("pii_detection")
    if not pipe or _model_status.get("pii_detection") != "ready":
        raise HTTPException(503, detail={"error": "model_not_ready", "model": "pii_detection"})

    entities = _infer_pii(pipe, req.text)
    pii_types = list({e["entity"] for e in entities})
    return {
        "has_pii": len(entities) > 0,
        "entities": entities,
        "pii_types": pii_types,
        "confidence": round(max((e["score"] for e in entities), default=0.0), 3),
        "provider": _active_provider,
    }


@app.post("/analyze/ensemble")
async def analyze_ensemble(req: EnsembleRequest):
    """Full ensemble: all 7 lightweight models with weighted scoring."""
    if not any(s == "ready" for s in _model_status.values()):
        # No models ready yet — return loading state
        return {
            "level": "safe",
            "score": 0,
            "loading": True,
            "models_ready": 0,
            "models_total": len(LIGHTWEIGHT_MODELS),
            "provider": _active_provider,
        }

    result = _ensemble_score(req.url, req.text)

    # Append PII info if available
    pii_info = None
    if req.text and _model_status.get("pii_detection") == "ready":
        try:
            entities = _infer_pii(_model_pipes["pii_detection"], req.text)
            if entities:
                pii_info = {"has_pii": True, "pii_types": list({e["entity"] for e in entities})}
        except Exception:
            pass

    return {
        **result,
        "pii": pii_info,
        "provider": _active_provider,
        "models_ready": sum(1 for s in _model_status.values() if s == "ready"),
        "models_total": len(LIGHTWEIGHT_MODELS),
        "heavy_model_active": _heavy_status == "ready",
    }

# ---------------------------------------------------------------------------
# Routes — Heavy Model (toggle-gated)
# ---------------------------------------------------------------------------
def _load_heavy_model_thread(model_id: str):
    """Downloads and loads the heavy generative LLM in a background thread."""
    global _heavy_model, _heavy_model_id, _heavy_status, _heavy_progress
    try:
        _heavy_status = "downloading"
        _heavy_progress = 0
        log.info(f"⏬ Downloading heavy model: {model_id}")

        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline as hf_pipeline

        # Use a progress callback to track download
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        _heavy_progress = 30
        _heavy_status = "loading"
        log.info(f"🔧 Loading heavy model into memory: {model_id}")
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            torch_dtype="auto",
            device_map="auto",
            low_cpu_mem_usage=True,
        )
        _heavy_progress = 90
        _heavy_model = hf_pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            max_new_tokens=256,
            do_sample=False,
        )
        _heavy_model_id = model_id
        _heavy_status = "ready"
        _heavy_progress = 100
        log.info(f"✅ Heavy model ready: {model_id}")
    except Exception as exc:
        _heavy_status = "failed"
        _heavy_model = None
        log.error(f"❌ Heavy model failed: {exc}")


@app.post("/heavy/load")
async def heavy_load(req: HeavyLoadRequest):
    """Starts downloading and loading the selected heavy generative LLM."""
    global _heavy_status
    if req.model_id not in HEAVY_MODELS:
        raise HTTPException(400, detail=f"Unknown model_id. Choose from: {list(HEAVY_MODELS.keys())}")
    if _heavy_status in ("downloading", "loading"):
        return {"ok": True, "status": _heavy_status, "progress": _heavy_progress}
    if _heavy_status == "ready" and _heavy_model_id == req.model_id:
        return {"ok": True, "status": "ready", "progress": 100}

    # Start loading in background thread
    t = threading.Thread(target=_load_heavy_model_thread, args=(req.model_id,), daemon=True)
    t.start()
    return {"ok": True, "status": "downloading", "progress": 0, "model_id": req.model_id}


@app.get("/heavy/status")
async def heavy_status():
    return {
        "loaded": _heavy_status == "ready",
        "model_id": _heavy_model_id,
        "status": _heavy_status,
        "progress": _heavy_progress,
    }


@app.post("/heavy/analyze")
async def heavy_analyze(req: HeavyAnalyzeRequest):
    """Deep threat analysis using the loaded generative LLM."""
    if _heavy_status != "ready" or _heavy_model is None:
        raise HTTPException(503, detail={"error": "heavy_model_not_ready", "status": _heavy_status})

    global _inference_counter
    try:
        # First run lightweight ensemble for structured signals
        ensemble = _ensemble_score(req.url, req.text)

        prompt = f"""You are an expert cybersecurity analyst. Analyze the following web page for phishing, scams, or malicious content.

URL: {req.url or "(not provided)"}
Page content excerpt: {req.text[:800] if req.text else "(not provided)"}
Initial risk signals: {ensemble['level']} (score: {ensemble['score']}/100)

Provide a concise analysis with:
1. Threat Level: SAFE / WARNING / DANGER
2. Explanation (2-3 sentences)
3. Recommendations (2-3 bullet points)

Be direct and factual."""

        result = _heavy_model(prompt, return_full_text=False)
        _inference_counter += 1
        output = result[0]["generated_text"] if result else ""

        return {
            "threat_level": ensemble["level"],
            "score": ensemble["score"],
            "explanation": output.strip(),
            "ensemble": ensemble,
            "model_id": _heavy_model_id,
            "provider": _active_provider,
        }
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))


@app.post("/heavy/unload")
async def heavy_unload():
    """Unloads the heavy model and frees RAM."""
    global _heavy_model, _heavy_model_id, _heavy_status, _heavy_progress
    if _heavy_model is not None:
        try:
            import gc, torch
            del _heavy_model
            gc.collect()
            torch.cuda.empty_cache()
        except Exception:
            pass
    _heavy_model = None
    _heavy_model_id = None
    _heavy_status = "unloaded"
    _heavy_progress = 0
    log.info("Heavy model unloaded.")
    return {"ok": True}


@app.get("/models")
async def list_models():
    """Returns all registered models and their status."""
    return {
        "lightweight": [
            {**{k: v for k, v in m.items() if k != "use_ort"}, "status": _model_status.get(m["key"], "unknown")}
            for m in LIGHTWEIGHT_MODELS
        ],
        "heavy_options": [{"id": k, "size": v} for k, v in HEAVY_MODELS.items()],
        "provider": _active_provider,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  AI Hygiene Companion — Local ML Backend")
    print("  http://127.0.0.1:8000")
    print("  Press Ctrl+C to stop")
    print("="*60 + "\n")
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="warning",  # suppress uvicorn noise; our logger handles info
    )
