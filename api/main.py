"""
AI Hygiene Companion — FastAPI Backend
Minimal REST API for URL and text risk analysis.
"""

import hashlib
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

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


class HealthResponse(BaseModel):
    status: str
    service: str


# --- FastAPI App ---

app = FastAPI(
    title="AI Hygiene Companion API",
    description="Risk analysis API for the AI Hygiene Companion Chrome extension",
    version="1.0.0",
)

# CORS — allow extension to call from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- In-memory store (keyed by hash for consistent dummy responses) ---

SUSPICIOUS_KEYWORDS = [
    "verify", "account", "password", "login", "signin",
    "banking", "secure", "urgent", "confirm", "suspend",
    "suspicious", "phishing", "click here", "update info",
]

DANGER_PATTERNS = [
    "http_protocol",
    "typosquatting",
    "ip_address_hostname",
    "external_redirect_param",
    "data_uri",
]

WARNING_PATTERNS = [
    "suspicious_tld",
    "excessive_subdomains",
    "suspicious_login_path",
    "long_url",
    "url_with_at_symbol",
]


def _hash_input(value: str) -> int:
    """Deterministic hash in 0–999 range for consistent dummy responses."""
    return int(hashlib.md5(value.encode()).hexdigest(), 16) % 1000


def _score_to_level(score: int) -> RiskLevel:
    if score >= 50:
        return RiskLevel.DANGER
    elif score >= 25:
        return RiskLevel.WARNING
    return RiskLevel.SAFE


# --- Endpoints ---

@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health():
    return HealthResponse(status="ok", service="ai-hygiene-api")


@app.post("/analyze/url", response_model=RiskAnalysisResponse, tags=["analysis"])
async def analyze_url(body: URLAnalysisRequest):
    """
    Analyze a URL and return a risk assessment.
    Returns consistent dummy data keyed to the URL hash.
    """
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url cannot be empty")

    h = _hash_input(url)
    score = h % 100

    if score >= 50:
        patterns = DANGER_PATTERNS[:2]
        reason = "High-risk indicators detected in URL."
    elif score >= 25:
        patterns = WARNING_PATTERNS[:2]
        reason = "Some suspicious patterns found in URL."
    else:
        patterns = []
        reason = "No risks detected in URL."

    return RiskAnalysisResponse(
        level=_score_to_level(score),
        score=score,
        patterns=patterns,
        reason=reason,
    )


@app.post("/analyze/text", response_model=RiskAnalysisResponse, tags=["analysis"])
async def analyze_text(body: TextAnalysisRequest):
    """
    Analyze page text content and return a risk assessment.
    Checks for phishing/urgency language patterns.
    """
    text = body.text.strip().lower()
    if not text:
        raise HTTPException(status_code=400, detail="text cannot be empty")

    # Combine text (+ optional URL) for hashing
    combined = text + (body.url or "")
    score = _hash_input(combined) % 100

    # Detect suspicious keywords
    matched = [kw for kw in SUSPICIOUS_KEYWORDS if kw in text]
    pattern_count = len(matched)

    if pattern_count >= 3:
        level = RiskLevel.DANGER
        patterns = ["urgency_language_detected", "suspicious_phrases"]
        reason = f"Multiple urgency/phishing phrases detected: {', '.join(matched[:3])}"
    elif pattern_count >= 1:
        level = RiskLevel.WARNING
        patterns = ["suspicious_phrases"]
        reason = f"Potentially suspicious language found: {matched[0]}"
    else:
        level = RiskLevel.SAFE
        patterns = []
        reason = "Page text appears clean."

    return RiskAnalysisResponse(
        level=level,
        score=score,
        patterns=patterns,
        reason=reason,
    )
