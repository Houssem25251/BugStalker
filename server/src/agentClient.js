import { config } from './config.js';

// Thin HTTP client for the Python agent service. Node 18+ has a global fetch,
// so no extra dependency needed.
async function agentFetch(path, options = {}) {
  const res = await fetch(`${config.agentUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Agent ${path} -> ${res.status} ${body}`);
  }
  return res.json();
}

// GET /health on the agent — used by the gateway's /agent-health check.
export function pingAgent() {
  return agentFetch('/health');
}

// POST /analyze — runs the detect->fix->verify->retry loop and returns the result.
export function analyzeCode({ code, language = '', maxAttempts = 2 }) {
  return agentFetch('/analyze', {
    method: 'POST',
    body: JSON.stringify({ code, language, max_attempts: maxAttempts }),
  });
}
