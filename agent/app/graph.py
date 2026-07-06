"""The agent's LangGraph — the detect+fix -> verify -> retry loop.

Speed-optimized version:
  [x] detect_fix — ONE LLM call finds the bugs AND proposes the fix
                   (Groq gpt-oss-120b, a reasoning model on fast hardware)
  [x] verify     — generate a test (Groq llama-3.3, fast), then run it against
                   BOTH the original and the fixed code IN PARALLEL. Trust the
                   fix only if the test FAILS on the buggy code and PASSES on
                   the fix (= the test actually catches the bug).
  [x] retry      — if verify fails and attempts remain, loop back to fix with
                   the failure fed back in (default max_attempts is 1: no retry)

Graph:
  START -> detect_fix -> (bugs? verify : END)
  verify -> (passed OR out of attempts ? END : fix)
  fix -> verify
"""
import json
from concurrent.futures import ThreadPoolExecutor
from typing import List, TypedDict

from langgraph.graph import END, START, StateGraph

from app import config
from app.llm import chat_with_fallback
from app.sandbox import run_code


class AgentState(TypedDict, total=False):
    code: str                  # input: the code to analyze
    language: str              # input: e.g. "javascript", "python"
    bugs: List[dict]           # detect output
    fixed_code: str            # fix output: corrected code
    explanation: str           # fix output: what changed
    test_code: str             # verify: the generated test (assertions only)
    verification: dict         # verify: both runs + discrimination info
    verification_status: str   # verify: "passed" | "failed"
    attempts: int              # how many fix attempts have been made
    max_attempts: int          # cap on fix attempts


# One call does detection AND fixing — saves a full LLM round trip.
DETECT_FIX_PROMPT = """You are an expert software engineer and bug hunter. Analyze the following {language} code.

1. Identify all bugs, logic errors, and likely mistakes.
2. Rewrite the code so ALL of those bugs are fixed. Preserve the original intent, the public interface (function/class names and signatures), and the style; change only what's needed.

Return ONLY a JSON object (no prose, no markdown fences):
{{"bugs": [{{"line": <line number or null>, "severity": "low" | "medium" | "high", "description": "<concise explanation>"}}],
  "fixed_code": "<the complete corrected code>",
  "explanation": "<brief summary of what you changed and why>"}}

If you find no bugs, return exactly: {{"bugs": [], "fixed_code": "", "explanation": ""}}

Code:
{code}
"""

# NOTE: the test is written as assertions ONLY — it must NOT redefine the code.
# We prepend the code (original or fixed) to this test at run time, so the same
# test can be run against both versions.
TEST_PROMPT = """You are a test engineer. Below is {language} code and a list of bugs it is believed to contain.

Write ONLY the TEST CODE (do NOT include or redefine the code itself). Assume the code above is already defined in the same file, directly ABOVE your test code, so you can call its functions/classes directly.

Your test must:
1. call the code with concrete inputs and assert the CORRECT / INTENDED results (the behavior the code *should* have, not its current buggy behavior),
2. specifically cover the reported bugs so a buggy version would fail,
3. print "PASS" if every assertion holds,
4. exit with a NON-ZERO exit code if any assertion fails (a failing assertion, or sys.exit(1) / process.exit(1)).

Reported bugs (JSON):
{bugs}

Return ONLY a JSON object (no prose, no markdown fences):
{{"test_code": "<the test code as a single string>"}}

Code (for reference — do NOT include it in your answer):
{code}
"""


def _parse_json_object(text: str) -> dict:
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        data = json.loads(text[start:end])
        return data if isinstance(data, dict) else {}
    except (ValueError, json.JSONDecodeError):
        return {}


def _passed(run: dict) -> bool:
    return bool(run.get("ran")) and not run.get("timed_out") and run.get("exit_code") == 0


def detect_fix_node(state: AgentState) -> AgentState:
    """First pass: find the bugs and fix them in a single reasoning-model call."""
    prompt = DETECT_FIX_PROMPT.format(
        language=state.get("language") or "unknown-language",
        code=state["code"],
    )
    obj = _parse_json_object(chat_with_fallback(prompt, groq_model=config.GROQ_REASONING_MODEL))
    bugs = obj.get("bugs", [])
    return {
        "bugs": bugs if isinstance(bugs, list) else [],
        "fixed_code": obj.get("fixed_code", ""),
        "explanation": obj.get("explanation", ""),
        "attempts": 1,
    }


def _build_retry_fix_prompt(state: AgentState) -> str:
    """Fix-only prompt used on retries, with the previous failure fed back in."""
    language = state.get("language") or "unknown-language"
    bugs = json.dumps(state.get("bugs", []), indent=2)
    ver = state.get("verification", {}) or {}
    fixed_run = ver.get("fixed_run", {}) or {}
    return f"""You are an expert software engineer. The following {language} code has these known bugs (JSON):
{bugs}

Rewrite the code so ALL of these bugs are fixed. Preserve the original intent, the public interface (function/class names and signatures), and the style; change only what's needed.

Your PREVIOUS fix attempt FAILED automated verification. That attempt was:
{state.get("fixed_code", "")}

Running the test against it produced:
- exit_code: {fixed_run.get('exit_code')}
- stdout: {fixed_run.get('stdout', '')}
- stderr: {fixed_run.get('stderr', '')}
- note: {ver.get('note', '')}

Diagnose why it failed and produce a corrected version that will pass.

Return ONLY a JSON object (no prose, no markdown fences):
{{"fixed_code": "<the complete corrected code>", "explanation": "<brief summary of what you changed and why>"}}

Original code:
{state['code']}
"""


def fix_node(state: AgentState) -> AgentState:
    """Retry-only node: re-fix with the verification failure as feedback."""
    obj = _parse_json_object(
        chat_with_fallback(_build_retry_fix_prompt(state), groq_model=config.GROQ_REASONING_MODEL)
    )
    return {
        "fixed_code": obj.get("fixed_code", ""),
        "explanation": obj.get("explanation", ""),
        "attempts": state.get("attempts", 0) + 1,
    }


def verify_node(state: AgentState) -> AgentState:
    language = state.get("language") or "unknown-language"
    original_code = state.get("code", "")
    fixed_code = state.get("fixed_code", "")

    prompt = TEST_PROMPT.format(
        language=language,
        bugs=json.dumps(state.get("bugs", []), indent=2),
        code=original_code,
    )
    # Test generation is mechanical — use the fast default Groq model.
    test_code = _parse_json_object(chat_with_fallback(prompt)).get("test_code", "")

    if not test_code.strip() or not fixed_code.strip():
        return {
            "test_code": test_code,
            "verification": {"note": "No test or no fixed code was generated."},
            "verification_status": "failed",
        }

    # Same test, run against both versions — in PARALLEL (they're independent).
    with ThreadPoolExecutor(max_workers=2) as pool:
        original_future = pool.submit(run_code, original_code + "\n\n" + test_code, language)
        fixed_future = pool.submit(run_code, fixed_code + "\n\n" + test_code, language)
        original_run = original_future.result()
        fixed_run = fixed_future.result()

    fixed_ok = _passed(fixed_run)
    original_ok = _passed(original_run)
    # The test "discriminates" if it FAILS on the buggy original.
    discriminating = bool(original_run.get("ran")) and not original_ok

    if not fixed_ok:
        note = "The fixed code did not pass the generated test."
    elif not discriminating:
        note = ("The test also passes on the ORIGINAL code, so it does not prove the bug "
                "was fixed (weak test, or the reported bug may be a false positive).")
    else:
        note = "Verified: the test fails on the original code and passes on the fix."

    return {
        "test_code": test_code,
        "verification": {
            "discriminating": discriminating,
            "fixed_run": fixed_run,
            "original_run": original_run,
            "note": note,
        },
        "verification_status": "passed" if (fixed_ok and discriminating) else "failed",
    }


def route_after_detect_fix(state: AgentState) -> str:
    return "verify" if state.get("bugs") else END


def route_after_verify(state: AgentState) -> str:
    if state.get("verification_status") == "passed":
        return END
    if state.get("attempts", 0) >= state.get("max_attempts", 1):
        return END   # give up after the cap — return the best attempt, marked failed
    return "fix"     # retry with the failure fed back in


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("detect_fix", detect_fix_node)
    g.add_node("fix", fix_node)
    g.add_node("verify", verify_node)
    g.add_edge(START, "detect_fix")
    g.add_conditional_edges("detect_fix", route_after_detect_fix, {"verify": "verify", END: END})
    g.add_conditional_edges("verify", route_after_verify, {"fix": "fix", END: END})
    g.add_edge("fix", "verify")
    return g.compile()


agent_graph = build_graph()


def run_analysis(code: str, language: str = "", max_attempts: int = 1) -> dict:
    result = agent_graph.invoke({
        "code": code,
        "language": language,
        "attempts": 0,
        "max_attempts": max_attempts,
    })
    return {
        "bugs": result.get("bugs", []),
        "fixed_code": result.get("fixed_code", ""),
        "explanation": result.get("explanation", ""),
        "verification_status": result.get("verification_status"),
        "verification": result.get("verification"),
        "attempts": result.get("attempts", 0),
        "test_code": result.get("test_code", ""),
    }
