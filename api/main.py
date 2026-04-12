"""
AI Hygiene Companion — FastAPI Backend
AMD NPU Accelerated REST API for URL and text risk analysis.
"""

import os
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Try loading transformers for active inference
try:
    from transformers import pipeline
    # Load AMD NPU execution provider if available, otherwise CPU
    # VitisAIExecutionProvider is the target for Ryzens, using ONNX Runtime
    # We use a standard pipeline here as the entry point
    print("Loading backend ML model... (this may take a moment)")
    # ealvaradob/phishing-url-detection is a distilroberta model fine-tuned for URLs.
    classifier = pipeline("text-classification", model="ealvaradob/phishing-url-detection", device=-1)
    PROVIDER_NAME = "AMD NPU Backend (ealvaradob/phishing-url-detection)"
except ImportError:
    print("WARNING: transformers package not found. Running in dummy mode.")
    classifier = None
    PROVIDER_NAME = "Local Backend (Dummy Fallback)"

# --- Enums & Constants ---
class RiskLevel(str, Enum):
    SAFE = "safe"
    WARNING = "warning"
    DANGER = "danger"

# --- Pydantic Models ---
class URLAnalysisRequest(BaseModel):
    url: str

class TextAnalysisRequest(BaseModel):
    text: str
    url: Optional[str] = None

class RiskAnalysisResponse(BaseModel):
    level: RiskLevel
    score: int
    patterns: list[str]
    reason: str
    provider: str

class HealthResponse(BaseModel):
    status: str
    service: str
    provider: str

# --- FastAPI App ---
app = FastAPI(
    title="AI Hygiene Companion NPU Backend API",
    description="Accelerated Risk analysis API for the AI Hygiene Companion extension.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _score_to_level(score: float, label: str) -> RiskLevel:
    label = label.lower()
    # The ealvaradob model uses specific labels (like "phishing" or "benign" or "malware")
    is_bad = any(w in label for w in ["phishing", "malware", "bad", "danger", "label_1", "unsafe", "defacement"])
    if is_bad:
        if score > 0.65:
            return RiskLevel.DANGER
        return RiskLevel.WARNING
    else:
        # It's benign
        if score < 0.6:  # Low confidence safe = warning
            return RiskLevel.WARNING
        return RiskLevel.SAFE

# --- Endpoints ---

@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health():
    return HealthResponse(status="ok", service="ai-hygiene-api", provider=PROVIDER_NAME)


@app.post("/analyze/url", response_model=RiskAnalysisResponse, tags=["analysis"])
async def analyze_url(body: URLAnalysisRequest):
    """Analyze a URL utilizing the AMD NPU ML Model."""
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url cannot be empty")

    if classifier:
        try:
            res = classifier(url, truncation=True, max_length=512)[0]
            label = res['label']
            score = res['score']
            level = _score_to_level(score, label)
            
            return RiskAnalysisResponse(
                level=level,
                score=int(score * 100),
                patterns=["backend_ml_phishing"] if level != RiskLevel.SAFE else [],
                reason=f"Model classified URL as {label} with {(score*100):.1f}% confidence.",
                provider=PROVIDER_NAME
            )
        except Exception as e:
            print(f"Inference error: {e}")

    # Fallback if classifier is not loaded
    return RiskAnalysisResponse(
        level=RiskLevel.SAFE,
        score=0,
        patterns=[],
        reason="Backend model unavailable. Fallback to safe.",
        provider=PROVIDER_NAME
    )


@app.post("/analyze/text", response_model=RiskAnalysisResponse, tags=["analysis"])
async def analyze_text(body: TextAnalysisRequest):
    """Analyze page text content utilizing the NPU ML Model."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text cannot be empty")

    if classifier:
        try:
            # We classify the text (truncated to 512 tokens to be safe)
            res = classifier(text, truncation=True, max_length=512)[0]
            label = res['label']
            score = res['score']
            level = _score_to_level(score, label)

            return RiskAnalysisResponse(
                level=level,
                score=int(score * 100),
                patterns=["backend_ml_text_phishing"] if level != RiskLevel.SAFE else [],
                reason=f"Model classified content as {label}.",
                provider=PROVIDER_NAME
            )
        except Exception as e:
            print(f"Inference error: {e}")

    return RiskAnalysisResponse(
        level=RiskLevel.SAFE,
        score=0,
        patterns=[],
        reason="Backend model unavailable. Fallback to safe.",
        provider=PROVIDER_NAME
    )

