"""LLM providers for the agent.

Strategy: Groq FIRST for everything (fast inference on LPUs), Gemini as the
automatic fallback if Groq errors or hits a rate limit.

- detect+fix  -> openai/gpt-oss-120b on Groq (reasoning model, still fast)
- test gen    -> llama-3.3-70b on Groq (mechanical task, fastest thing we have)
- fallback    -> gemini-2.5-flash
"""
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI

from app import config


def get_groq_llm(temperature: float = 0, model: str | None = None):
    return ChatGroq(
        api_key=config.GROQ_API_KEY,
        model=model or config.GROQ_MODEL,
        temperature=temperature,
    )


def get_gemini_llm(temperature: float = 0):
    return ChatGoogleGenerativeAI(
        google_api_key=config.GEMINI_API_KEY,
        model=config.GEMINI_MODEL,
        temperature=temperature,
    )


def _try_provider(factory, prompt):
    try:
        reply = factory().invoke(prompt).content
        return {"ok": True, "reply": reply}
    except Exception as e:
        # Surface the error type + message so we can diagnose bad keys / model names.
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def test_providers(prompt: str = "Reply with exactly one word: pong"):
    """Independently ping each provider — powers the /llm-test endpoint."""
    return {
        "groq": _try_provider(get_groq_llm, prompt),
        "groq_reasoning": _try_provider(
            lambda: get_groq_llm(model=config.GROQ_REASONING_MODEL), prompt
        ),
        "gemini": _try_provider(get_gemini_llm, prompt),
    }


def chat_with_fallback(prompt: str, groq_model: str | None = None) -> str:
    """Send a prompt: Groq first (optionally a specific Groq model), Gemini second.

    Gemini only runs when Groq fails (rate limit, outage, bad response) — this
    keeps the fast path fast while staying resilient.
    """
    last_error = None
    for factory in (lambda: get_groq_llm(model=groq_model), get_gemini_llm):
        try:
            return factory().invoke(prompt).content
        except Exception as e:
            last_error = e
    raise RuntimeError(f"All providers failed. Last error: {last_error}")
