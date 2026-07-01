"""LLM providers for the agent.

- Groq  -> fast detection/scanning pass
- Gemini -> deeper reasoning / fix generation

Both are wrapped as LangChain chat models so the agent loop (3.4) can use a
uniform .invoke() interface. Includes a simple fallback: if the preferred
provider errors (e.g. 429 rate limit), fall back to the other one.
"""
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI

from app import config


def get_groq_llm(temperature: float = 0):
    return ChatGroq(
        api_key=config.GROQ_API_KEY,
        model=config.GROQ_MODEL,
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
        "gemini": _try_provider(get_gemini_llm, prompt),
    }


def chat_with_fallback(prompt: str, prefer: str = "groq") -> str:
    """Send a prompt, trying the preferred provider first, then the other.

    This is the reusable helper the detect->fix->verify loop will call in 3.4+.
    """
    order = (
        [get_groq_llm, get_gemini_llm]
        if prefer == "groq"
        else [get_gemini_llm, get_groq_llm]
    )
    last_error = None
    for factory in order:
        try:
            return factory().invoke(prompt).content
        except Exception as e:
            last_error = e
    raise RuntimeError(f"All providers failed. Last error: {last_error}")
