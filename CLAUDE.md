# BugStalker — Project Context

This file is the source of truth for Claude Code. Read it fully before doing any work.

## What BugStalker is

An AI agent application that finds and fixes bugs in code. It analyzes code, identifies bugs,
proposes fixes, **verifies them in a sandbox (compile + run tests) before showing them**, and
explains what it changed. Inputs: pasted code, uploaded files, and GitHub repos.

The non-negotiable principle: a fix is never proposed until it has been verified. An AI that
confidently breaks code is worse than none. Sandboxed verification is the spine of the product.

## Architecture (decided)

Two backends in two languages, plus a React frontend.

```
React frontend
    |
    v
Node + Express  (gateway: owns auth, owns the database, orchestrates jobs)
    |  REST, async job pattern
    v
Python + LangChain/LangGraph  (the agent: detect -> fix -> verify -> retry loop)
```

- **Node is the gateway.** The React app only ever talks to Node. Node owns auth and the database.
- **Python is an internal service.** It does only the agent work. It is not exposed to the frontend directly.
- **Communication: plain REST with an async job pattern.** No Redis/message queue in v1. Node creates a
  job row in Postgres, calls the Python service over HTTP, Python writes the result back. The Postgres
  job row IS the queue for now. Swap in a real queue (Redis/BullMQ) later when there are concurrent users.
- **Frontend gets results by polling.** React polls Node every couple seconds until job status flips to
  done/failed. No WebSockets in v1 — upgrade to streaming later if live progress is wanted.

Rationale: the agent loop is slow (30s–minutes, throttled by free-tier rate limits), so a normal
request/response would time out. Async jobs + polling is the simplest thing that works. Don't add a
queue or websockets until the core features exist.

## Tech stack (decided)

- **General backend:** Node + Express. Handles auth, users, sessions, job records, orchestration.
- **Agent backend:** Python + LangChain / LangGraph. LangGraph is used for the stateful detect→fix→verify→retry loop.
- **Database:** Neon (serverless Postgres).
- **ORM:** Drizzle (TypeScript, type-safe) — used from the Node side.
- **Frontend:** React. Will embed Monaco editor later for code paste + diff viewing (not now).

## LLM providers (decided)

Using **free tiers** of Groq and Gemini. Free-tier rate limits are TIGHT — design around them from day one.

- **Groq** — very fast inference (LPU). Use for the fast scanning/detection pass. Best free models:
  `openai/gpt-oss-120b` or `llama-3.3-70b-versatile`. Note: free-tier daily request caps are low
  (~1K requests/day per model). Limits are per org, not per key — extra keys don't add quota. BUT limits
  are per-model, so using two different models gives separate buckets (useful).
- **Gemini** — large 1M-token context window (great for reasoning over a whole file/project) and for fix
  generation. Free tier is Flash/Flash-Lite only now (Pro is paywalled). Best free model: `gemini-2.5-flash`
  (or flash-lite for cheap high-volume calls). Verify current model names at call time — they change often.

Design implications:
- **Split work by model strength:** Groq for fast detection scans, Gemini for deep "reason over whole file"
  and fix generation.
- **Fallback chain:** when one provider returns 429 (rate limited), flip to the other instead of failing.
- **Be frugal:** batch files into fewer calls, use prompt caching (cached tokens don't count against limits),
  never loop infinitely on a single bug. Cap retries.
- **Track usage:** the api_usage table exists so consumption is visible and 429s aren't a surprise.

### Privacy caution
Free tiers of both providers may train on inputs. **Do not feed proprietary/sensitive code.** Put a
disclaimer in the UI. Read all API keys from environment variables — never hardcode, never commit.

## Data model (planned)

- **users** — id, email, password_hash, created_at
- **jobs** — id, user_id (FK), input_type (paste|file|repo), input_ref (the code or repo URL),
  status (queued|running|done|failed), created_at, updated_at
- **results** — id, job_id (FK), bugs_found, fixes_proposed, diff, verification_status, explanation
- **api_usage** — id, user_id (FK), provider (groq|gemini), tokens_used, created_at

## Build order (do these in sequence — do not jump ahead)

1. **Auth FIRST.** Everything hangs off a user. Nothing else until login/signup works.
2. Jobs table + job creation endpoint.
3. Python agent service skeleton + the detect→fix→verify loop.
4. Wire Node ↔ Python over REST.
5. Frontend: paste input + polling + result display.
6. Then expand: file upload, GitHub repo input, more features.

## CURRENT STEP: Auth only

Set up authentication and nothing else:
- Drizzle schema with the **users** table (id, email, password_hash, created_at)
- Neon connection (connection string from env var, e.g. DATABASE_URL)
- Express routes: **signup** and **login**
- **JWT** for sessions
- Password hashing with **bcrypt**

Read the existing project structure before adding anything. Do not scaffold jobs, the agent, or the
frontend yet. Keep this scoped strictly to auth.

## Conventions / guardrails

- Secrets only via environment variables. Never commit `.env`.
- Don't add dependencies beyond what a step needs.
- Don't build ahead of the current step, even if it seems efficient.
- When unsure about a provider's current model names or limits, flag it rather than guessing.
