from fastapi import FastAPI
from pydantic import BaseModel

from app.config import provider_status
from app.llm import test_providers
from app.graph import run_analysis
from app.sandbox import run_code

# BugStalker agent service. Internal-only: Node (the gateway) calls this over
# REST; it is never exposed directly to the frontend. For now it's just a
# skeleton with a health check — the detect->fix->verify loop comes later.
app = FastAPI(title="BugStalker Agent", version="0.0.1")


@app.get("/health")
def health():
    return {"status": "ok", "service": "bugstalker-agent"}


@app.get("/config")
def config_check():
    # Shows whether the API keys are loaded (booleans only — never the keys).
    return provider_status()


@app.get("/llm-test")
def llm_test():
    # Sends a tiny prompt to Groq and Gemini and reports each result.
    return test_providers()


class AnalyzeRequest(BaseModel):
    code: str
    language: str = ""
    max_attempts: int = 2


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    # Runs the full detect -> fix -> verify -> retry loop and returns the result.
    return run_analysis(req.code, req.language, req.max_attempts)


class RunRequest(BaseModel):
    code: str
    language: str
    timeout: int = 10


@app.post("/run")
def run(req: RunRequest):
    # Executes code in the local sandbox and returns its output. (Testing the runner.)
    return run_code(req.code, req.language, req.timeout)
