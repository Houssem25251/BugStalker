"""A minimal local code sandbox.

Runs a snippet in a subprocess with a timeout and captures its output.

⚠️ SECURITY: this executes code directly on the host with NO real isolation
(no container, no network/filesystem restrictions). It is acceptable for a
LOCAL prototype analyzing your own code, but MUST be replaced with a proper
container sandbox (Docker / gVisor / a hosted runner) before any deployment.
This is deliberate, documented tech-debt for v1.
"""
import os
import subprocess
import sys
import tempfile

# Supported languages -> source file extension.
_EXTENSIONS = {
    "python": ".py", "py": ".py",
    "javascript": ".js", "js": ".js", "node": ".js",
}

MAX_TIMEOUT = 15  # hard cap so a runaway snippet can't hang the service


def _command_for(language: str, filepath: str):
    lang = (language or "").lower()
    if lang in ("python", "py"):
        return [sys.executable, filepath]      # the venv's Python
    if lang in ("javascript", "js", "node"):
        return ["node", filepath]
    return None


def run_code(code: str, language: str, timeout: int = 10) -> dict:
    """Execute `code` and return {ran, timed_out, exit_code, stdout, stderr} (or an error)."""
    lang = (language or "").lower()
    ext = _EXTENSIONS.get(lang)
    if ext is None:
        return {
            "ran": False,
            "error": f"Unsupported language: {language!r}. Supported: python, javascript.",
        }

    timeout = max(1, min(int(timeout), MAX_TIMEOUT))

    tmp_dir = tempfile.mkdtemp(prefix="bugstalker_")
    filepath = os.path.join(tmp_dir, f"snippet{ext}")
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        cmd = _command_for(language, filepath)
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return {
                "ran": True,
                "timed_out": False,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
            }
        except subprocess.TimeoutExpired as e:
            return {
                "ran": True,
                "timed_out": True,
                "exit_code": None,
                "stdout": e.stdout or "",
                "stderr": (e.stderr or "") + f"\n[killed after {timeout}s timeout]",
            }
        except FileNotFoundError as e:
            # e.g. 'node' isn't on PATH
            return {"ran": False, "error": f"Runtime not found ({e}). Is it installed and on PATH?"}
    finally:
        # best-effort cleanup
        try:
            os.remove(filepath)
            os.rmdir(tmp_dir)
        except OSError:
            pass
