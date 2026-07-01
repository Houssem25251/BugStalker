import os
from pathlib import Path

from dotenv import load_dotenv

# Load agent/.env regardless of where uvicorn was launched from.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# --- LLM provider keys (read from env, never hardcoded) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- Default model names (overridable via env) ---
# NOTE: provider model names change often — we'll confirm these at call time in 3.3.
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def provider_status():
    """Report whether each key is present — WITHOUT ever returning the key itself."""
    return {
        "groq_configured": bool(GROQ_API_KEY),
        "gemini_configured": bool(GEMINI_API_KEY),
        "groq_model": GROQ_MODEL,
        "gemini_model": GEMINI_MODEL,
    }
