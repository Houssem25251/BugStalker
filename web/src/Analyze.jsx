import { useEffect, useRef, useState } from 'react';
import { createJob, getJob, getJobs } from './api';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

function firstLine(s = '') {
  const line = (s.split('\n').find((l) => l.trim()) || s).trim();
  return line.length > 32 ? `${line.slice(0, 32)}…` : line || 'Untitled';
}

const LANGS = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
];

const EXT_LANG = { py: 'python', js: 'javascript' };

// Custom dropdown (native <select> can't be styled). Opens upward since it
// sits at the bottom of the screen.
function LanguageSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGS.find((l) => l.value === value) || LANGS[0];

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="lang-select" ref={ref}>
      <button type="button" className="lang-trigger" onClick={() => setOpen((o) => !o)}>
        {current.label}
        <span className="caret">▾</span>
      </button>
      {open && (
        <ul className="lang-menu">
          {LANGS.map((l) => (
            <li key={l.value}>
              <button
                type="button"
                className={`lang-option ${l.value === value ? 'active' : ''}`}
                onClick={() => { onChange(l.value); setOpen(false); }}
              >
                {l.label}
                {l.value === value && <span className="check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Analyze({ onLogout }) {
  const [mode, setMode] = useState('code'); // 'code' | 'repo'
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [fileName, setFileName] = useState(''); // set when code came from an uploaded file
  const [repoUrl, setRepoUrl] = useState('');
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const idRef = useRef(0);
  const pollRef = useRef(null);
  const logEndRef = useRef(null);
  const currentRef = useRef(null); // assistant message id of the running analysis
  const fileInputRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    try {
      const { jobs } = await getJobs();
      setHistory(jobs || []);
    } catch { /* ignore */ }
  }

  function updateMsg(id, patch) {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function poll(jobId, assistantId) {
    pollRef.current = setInterval(async () => {
      try {
        const { job, result } = await getJob(jobId);
        updateMsg(assistantId, { status: job.status });
        if (job.status === 'done' || job.status === 'failed') {
          clearInterval(pollRef.current);
          updateMsg(assistantId, { status: job.status, result });
          setBusy(false);
          loadHistory();
        }
      } catch (err) {
        clearInterval(pollRef.current);
        updateMsg(assistantId, { status: 'failed', error: err.message });
        setBusy(false);
      }
    }, 2500);
  }

  async function send(e) {
    e.preventDefault();
    if (busy) return;

    let payload;
    let userMsg;
    if (mode === 'repo') {
      const url = repoUrl.trim();
      if (!url) return;
      payload = { inputType: 'repo', inputRef: url, language: '' };
      userMsg = { role: 'user', url };
    } else {
      if (!code.trim()) return;
      payload = { inputType: fileName ? 'file' : 'paste', inputRef: code, language };
      userMsg = { role: 'user', code, language, fileName };
    }

    setBusy(true);
    const userId = ++idRef.current;
    const assistantId = ++idRef.current;

    setMessages((ms) => [
      ...ms,
      { id: userId, ...userMsg },
      { id: assistantId, role: 'assistant', status: 'queued', result: null, isRepo: mode === 'repo' },
    ]);
    setCode('');
    setFileName('');
    setRepoUrl('');
    currentRef.current = assistantId;

    try {
      const { job } = await createJob(payload);
      setActiveJobId(job.id);
      updateMsg(assistantId, { status: job.status });
      poll(job.id, assistantId);
      loadHistory();
    } catch (err) {
      updateMsg(assistantId, { status: 'failed', error: err.message });
      setBusy(false);
    }
  }

  function onFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > 60_000) {
      alert('File too large (max 60 KB for now).');
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    const lang = EXT_LANG[ext];
    if (!lang) {
      alert('Only .py and .js files are supported for now.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCode(String(reader.result || ''));
      setLanguage(lang);
      setFileName(file.name);
      setMode('code');
    };
    reader.readAsText(file);
  }

  async function openJob(jobId) {
    if (busy) return;
    clearInterval(pollRef.current);
    setActiveJobId(jobId);
    setSidebarOpen(false);
    try {
      const { job, result } = await getJob(jobId);
      const uid = ++idRef.current;
      const aid = ++idRef.current;
      const userMsg =
        job.inputType === 'repo'
          ? { role: 'user', url: job.inputRef }
          : { role: 'user', code: job.inputRef, language: job.language || '' };
      setMessages([
        { id: uid, ...userMsg },
        { id: aid, role: 'assistant', status: job.status, result: result || null },
      ]);
    } catch { /* ignore */ }
  }

  function newChat() {
    clearInterval(pollRef.current);
    setMessages([]);
    setActiveJobId(null);
    setBusy(false);
    setSidebarOpen(false);
  }

  // Stop watching the running analysis. (The backend job still finishes and
  // will appear as done in history — we just stop showing it live.)
  function cancel() {
    clearInterval(pollRef.current);
    if (currentRef.current != null) updateMsg(currentRef.current, { status: 'canceled' });
    setBusy(false);
    loadHistory();
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(e);
  }

  return (
    <div className="layout">
      <button
        type="button"
        className="menu-btn"
        aria-label="Menu"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        ☰
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Logo size={26} /> BugStalker</div>
        <button className="new-chat" onClick={newChat}>＋ New analysis</button>
        <div className="history">
          {history.length === 0 && <p className="muted history-empty">No history yet</p>}
          {history.map((job) => (
            <button
              key={job.id}
              className={`history-item ${job.id === activeJobId ? 'active' : ''}`}
              onClick={() => openJob(job.id)}
              title={job.inputRef}
            >
              <span className="history-title">
                {job.inputType === 'repo' ? '📦 ' : ''}{firstLine(job.inputRef)}
              </span>
              <span className="history-meta">
                {job.inputType === 'repo' ? 'repo' : job.language || '?'} · {job.status}
              </span>
            </button>
          ))}
        </div>
        <ThemeToggle block />
        <button className="secondary logout" onClick={onLogout}>Log out</button>
      </aside>

      <main className="main">
      <div className="chat">
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Logo size={72} />
              <p>Paste code, upload a file, or point me at a GitHub repo — I'll hunt for bugs and prove the fix by running it. 🐛</p>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? <UserMsg key={m.id} m={m} /> : <AgentMsg key={m.id} m={m} />,
          )}

          <div ref={logEndRef} />
        </div>

        <form className="chat-input" onSubmit={send}>
          <div className="chat-input-row">
            <div className="mode-toggle">
              <button type="button" className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Code</button>
              <button type="button" className={mode === 'repo' ? 'on' : ''} onClick={() => setMode('repo')}>GitHub repo</button>
            </div>
            {mode === 'code' && <LanguageSelect value={language} onChange={setLanguage} />}
            {mode === 'code' && (
              <>
                <button type="button" className="secondary attach" onClick={() => fileInputRef.current?.click()}>
                  📎 File
                </button>
                <input ref={fileInputRef} type="file" accept=".py,.js" onChange={onFilePicked} hidden />
              </>
            )}
            <span className="muted" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}>
              {mode === 'code' ? 'Ctrl + Enter to send' : 'public repos only · up to 4 files'}
            </span>
          </div>

          {fileName && (
            <div className="file-chip-row">
              <div className="file-chip">
                📎 {fileName}
                <button type="button" className="ghost" onClick={() => { setFileName(''); setCode(''); }}>✕</button>
              </div>
            </div>
          )}

          <div className="chat-input-box">
            {mode === 'repo' ? (
              <input
                className="repo-input"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            ) : (
              <textarea
                value={code}
                onChange={(e) => { setCode(e.target.value); if (fileName) setFileName(''); }}
                onKeyDown={onKeyDown}
                placeholder="Paste your code here…"
                rows={4}
                spellCheck={false}
              />
            )}
            {busy ? (
              <button type="button" className="stop" onClick={cancel}>Stop</button>
            ) : (
              <button type="submit" disabled={mode === 'repo' ? !repoUrl.trim() : !code.trim()}>Send</button>
            )}
          </div>
        </form>
      </div>
      </main>
    </div>
  );
}

function UserMsg({ m }) {
  if (m.url) {
    return (
      <div className="msg user">
        <div className="bubble">
          <div className="msg-lang">github repo</div>
          <p style={{ margin: '6px 0 0' }}>📦 {m.url}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="msg user">
      <div className="bubble">
        <div className="msg-lang">{m.fileName ? `📎 ${m.fileName}` : m.language}</div>
        <pre>{m.code}</pre>
      </div>
    </div>
  );
}

function AgentMsg({ m }) {
  return (
    <div className="msg assistant">
      <div className="avatar"><Logo size={46} /></div>
      <div className="bubble">
        {m.result ? <Result result={m.result} /> : <Thinking status={m.status} isRepo={m.isRepo} error={m.error} />}
      </div>
    </div>
  );
}

function Thinking({ status, isRepo, error }) {
  if (status === 'failed') {
    return <p className="error" style={{ margin: 0 }}>❌ {error || 'Something went wrong.'}</p>;
  }
  if (status === 'canceled') {
    return <p className="muted" style={{ margin: 0 }}>Canceled.</p>;
  }
  const label =
    status === 'running'
      ? isRepo ? 'Fetching the repo and analyzing files… (can take a few minutes)' : 'Analyzing your code…'
      : 'Queued…';
  return (
    <p className="thinking">
      <span className="dots"><span /><span /><span /></span> {label}
    </p>
  );
}

function runSummary(r) {
  if (!r) return '';
  const parts = [`exit code: ${r.exit_code}${r.timed_out ? ' (timed out)' : ''}`];
  if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
  if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
  if (r.error) parts.push(`error: ${r.error}`);
  return parts.join('\n');
}

// Adapt the agent's snake_case per-file analysis to the shape <Result> expects.
function adaptAnalysis(a = {}) {
  return {
    bugs: a.bugs || [],
    fixedCode: a.fixed_code || '',
    verificationStatus: a.verification_status ?? null,
    explanation: a.explanation || '',
    raw: { verification: a.verification, test_code: a.test_code },
  };
}

function RepoResult({ result }) {
  const files = result.raw?.files || [];
  const passed = result.verificationStatus === 'passed';
  return (
    <div>
      <div className={`badge ${passed ? 'pass' : 'fail'}`} style={{ marginBottom: 6 }}>
        {passed ? '✅ Repo scan complete' : '⚠️ Repo scan complete — some fixes unverified'}
      </div>
      {result.explanation && <p className="muted" style={{ marginTop: 0 }}>{result.explanation}</p>}
      {files.map((f) => (
        <details key={f.path} className="repo-file" open={(f.analysis?.bugs || []).length > 0}>
          <summary>
            <code>{f.path}</code>
            <span className="muted"> — {(f.analysis?.bugs || []).length} bug(s)</span>
          </summary>
          <div style={{ marginTop: 10 }}>
            <Result result={adaptAnalysis(f.analysis)} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Result({ result }) {
  // Repo results carry a per-file breakdown.
  if (result.raw?.files) return <RepoResult result={result} />;

  const passed = result.verificationStatus === 'passed';
  const bugs = result.bugs || [];
  const raw = result.raw || {};
  const v = raw.verification || {};

  if (result.verificationStatus == null && bugs.length === 0 && !result.fixedCode) {
    return <p className="error" style={{ margin: 0 }}>{result.explanation || 'No result.'}</p>;
  }

  return (
    <div>
      <div className={`badge ${passed ? 'pass' : 'fail'}`} style={{ marginBottom: v.note ? 6 : 10 }}>
        {passed ? '✅ Fix verified — passed a test that catches the bug' : `⚠️ ${result.verificationStatus || 'not verified'}`}
      </div>
      {v.note && <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: '0.85rem' }}>{v.note}</p>}

      <strong>Bugs found ({bugs.length})</strong>
      {bugs.length > 0 && (
        <ul className="bugs">
          {bugs.map((b, i) => (
            <li key={i}>
              <span className="severity">{b.severity || '?'}</span> {b.description}
              {b.file && <code className="muted"> [{b.file}]</code>}
              {b.line != null && <span className="muted"> (line {b.line})</span>}
            </li>
          ))}
        </ul>
      )}

      {result.fixedCode && (
        <>
          <strong>Proposed fix</strong>
          <pre>{result.fixedCode}</pre>
        </>
      )}

      {result.explanation && <p className="muted" style={{ marginBottom: 0 }}>{result.explanation}</p>}

      {(raw.test_code || v.fixed_run || v.original_run) && (
        <details className="verify-details">
          <summary>Show verification details</summary>
          {raw.test_code && (
            <>
              <strong>Generated test</strong>
              <pre>{raw.test_code}</pre>
            </>
          )}
          {v.original_run && (
            <>
              <strong>Test run on the ORIGINAL code (should fail)</strong>
              <pre>{runSummary(v.original_run)}</pre>
            </>
          )}
          {v.fixed_run && (
            <>
              <strong>Test run on the FIXED code (should pass)</strong>
              <pre>{runSummary(v.fixed_run)}</pre>
            </>
          )}
        </details>
      )}
    </div>
  );
}
