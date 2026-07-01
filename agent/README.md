# BugStalker — Agent (Python + FastAPI)

Step 3 of the build order: the AI agent that detects → fixes → verifies bugs.
Internal service only — the Node gateway calls it over REST; it's never exposed
to the frontend directly.

## Setup

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # Windows PowerShell
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/health -> `{ "status": "ok", ... }`
Interactive API docs (FastAPI gives these for free): http://localhost:8000/docs

## Ports

- Node gateway: **3000**
- Python agent: **8000**

## Status

- [x] 3.1 FastAPI skeleton + /health
- [x] 3.2 Config + API keys
- [x] 3.3 Groq + Gemini connectivity (with 429 fallback)
- [x] 3.4 LangGraph detect -> fix -> verify -> retry loop
- [x] 3.5 Analyze endpoint (POST /analyze)
