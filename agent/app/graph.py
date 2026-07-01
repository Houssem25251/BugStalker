"""The agent's LangGraph — the detect -> fix -> verify -> retry loop.

  [x] detect  — find bugs in the code
  [x] fix     — propose a corrected version (uses previous failure as feedback)
  [x] verify  — generate a test, then run it against BOTH the original and the
                fixed code. Trust the fix only if the test FAILS on the buggy
                code and PASSES on the fix (= the test actually catches the bug).
  [x] retry   — if verify fails, loop back to fix (capped by max_attempts)

Graph:
  START -> detect -> (bugs? fix : END)
  fix -> verify
  verify -> (passed OR out of attempts ? END : fix)
"""
import json
from typing import List, TypedDict

from langgraph.graph import END, START, StateGraph

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


DETECT_PROMPT = """You are a meticulous bug-detection assistant. Analyze the following {language} code and identify bugs, logic errors, and likely mistakes.

Return ONLY a JSON array (no prose, no markdown fences). Each element must be an object:
{{"line": <line number or null>, "severity": "low" | "medium" | "high", "description": "<concise explanation>"}}

If you find no bugs, return exactly: []

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


def _parse_json_array(text: str) -> list:
    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        data = json.loads(text[start:end])
        return data if isinstance(data, list) else []
    except (ValueError, json.JSONDecodeError):
        return []


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


def detect_node(state: AgentState) -> AgentState:
    prompt = DETECT_PROMPT.format(
        language=state.get("language") or "unknown-language",
        code=state["code"],
    )
    raw = chat_with_fallback(prompt, prefer="groq")   # Groq: fast detection
    return {"bugs": _parse_json_array(raw)}


def _build_fix_prompt(state: AgentState) -> str:
    language = state.get("language") or "unknown-language"
    bugs = json.dumps(state.get("bugs", []), indent=2)
    prompt = f"""You are an expert software engineer. The following {language} code has these known bugs (JSON):
{bugs}

Rewrite the code so ALL of these bugs are fixed. Preserve the original intent, the public interface (function/class names and signatures), and the style; change only what's needed.
"""
    # On a retry, feed back exactly why the last attempt failed verification.
    if state.get("verification_status") == "failed":
        ver = state.get("verification", {}) or {}
        fixed_run = ver.get("fixed_run", {}) or {}
        prompt += f"""
Your PREVIOUS fix attempt FAILED automated verification. That attempt was:
{state.get("fixed_code", "")}

Running the test against it produced:
- exit_code: {fixed_run.get('exit_code')}
- stdout: {fixed_run.get('stdout', '')}
- stderr: {fixed_run.get('stderr', '')}
- note: {ver.get('note', '')}

Diagnose why it failed and produce a corrected version that will pass.
"""
    prompt += f"""
Return ONLY a JSON object (no prose, no markdown fences):
{{"fixed_code": "<the complete corrected code>", "explanation": "<brief summary of what you changed and why>"}}

Original code:
{state['code']}
"""
    return prompt


def fix_node(state: AgentState) -> AgentState:
    raw = chat_with_fallback(_build_fix_prompt(state), prefer="gemini")  # Gemini: fixes
    obj = _parse_json_object(raw)
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
    test_code = _parse_json_object(chat_with_fallback(prompt, prefer="gemini")).get("test_code", "")

    if not test_code.strip() or not fixed_code.strip():
        return {
            "test_code": test_code,
            "verification": {"note": "No test or no fixed code was generated."},
            "verification_status": "failed",
        }

    # Same test, run against both versions (code is prepended so the test can call it).
    original_run = run_code(original_code + "\n\n" + test_code, language)
    fixed_run = run_code(fixed_code + "\n\n" + test_code, language)

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


def route_after_detect(state: AgentState) -> str:
    return "fix" if state.get("bugs") else END


def route_after_verify(state: AgentState) -> str:
    if state.get("verification_status") == "passed":
        return END
    if state.get("attempts", 0) >= state.get("max_attempts", 2):
        return END   # give up after the cap — return the best attempt, marked failed
    return "fix"     # retry with the failure fed back in


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("detect", detect_node)
    g.add_node("fix", fix_node)
    g.add_node("verify", verify_node)
    g.add_edge(START, "detect")
    g.add_conditional_edges("detect", route_after_detect, {"fix": "fix", END: END})
    g.add_edge("fix", "verify")
    g.add_conditional_edges("verify", route_after_verify, {"fix": "fix", END: END})
    return g.compile()


agent_graph = build_graph()


def run_analysis(code: str, language: str = "", max_attempts: int = 2) -> dict:
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
