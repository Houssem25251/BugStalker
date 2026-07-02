// GitHub repo ingestion: fetch a public repo's analyzable files via the GitHub API.
// Kept deliberately small for v1: only .py/.js files, capped count + size,
// because free-tier LLM limits are tight.

const MAX_FILES = 4;              // how many files we analyze per repo
const MAX_FILE_BYTES = 60_000;    // skip huge files (token limits)

const EXTENSIONS = {
  '.py': 'python',
  '.js': 'javascript',
};

// Folders that are never worth analyzing.
const IGNORED_DIRS =
  /(^|\/)(node_modules|dist|build|out|vendor|\.venv|venv|__pycache__|coverage|tests?|__tests__|\.git)(\/|$)/;

function ghHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BugStalker',
  };
  // Optional: raises the API rate limit from 60/hr to 5000/hr.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// Accepts https://github.com/owner/repo, .git suffix, or /tree/<branch>/... URLs.
export function parseRepoUrl(url) {
  const m = String(url || '')
    .trim()
    .match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?(?:\/.*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3] || null };
}

async function gh(url) {
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) throw new Error('Repository not found (is it public?)');
  if (res.status === 403) throw new Error('GitHub API rate limit hit — try again later (or set GITHUB_TOKEN)');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

function languageFor(path) {
  const ext = Object.keys(EXTENSIONS).find((e) => path.endsWith(e));
  return ext ? EXTENSIONS[ext] : null;
}

// Returns { branch, totalCandidates, files: [{ path, language, content }] }
export async function fetchRepoFiles(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error('Not a valid GitHub repository URL');
  const { owner, repo } = parsed;

  let branch = parsed.branch;
  if (!branch) {
    const info = await gh(`https://api.github.com/repos/${owner}/${repo}`);
    branch = info.default_branch;
  }

  const tree = await gh(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );

  const candidates = (tree.tree || []).filter(
    (e) =>
      e.type === 'blob' &&
      languageFor(e.path) &&
      !IGNORED_DIRS.test(e.path) &&
      !e.path.endsWith('.min.js') &&
      (e.size ?? 0) > 20 &&
      (e.size ?? 0) <= MAX_FILE_BYTES,
  );

  const picked = candidates.slice(0, MAX_FILES);

  const files = [];
  for (const entry of picked) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${entry.path}`,
      { headers: { 'User-Agent': 'BugStalker' } },
    );
    if (!res.ok) continue; // skip unfetchable files rather than failing the job
    files.push({ path: entry.path, language: languageFor(entry.path), content: await res.text() });
  }

  return { branch, totalCandidates: candidates.length, files };
}
