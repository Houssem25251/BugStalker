// Small client for the Node gateway. All frontend -> backend calls go through here.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// --- token storage (JWT lives in localStorage) ---
export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => localStorage.setItem('token', t);
export const clearToken = () => localStorage.removeItem('token');

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- endpoints ---
export const health = () => api('/health');
export const signup = (email, password, phone) => api('/auth/signup', { method: 'POST', body: { email, password, phone } });
export const login = (email, password) => api('/auth/login', { method: 'POST', body: { email, password } });
export const createJob = (payload) => api('/jobs', { method: 'POST', body: payload, auth: true });
export const getJobs = () => api('/jobs', { auth: true });
export const getJob = (id) => api(`/jobs/${id}`, { auth: true });
