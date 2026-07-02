import { useEffect, useRef, useState } from 'react';
import { createJob, getJob, getJobs } from './api';
import Logo from './Logo';

function firstLine(s = '') {
  const line = (s.split('\n').find((l) => l.trim()) || s).trim();
  return line.length > 32 ? `${line.slice(0, 32)}…` : line || 'Untitled';
}

const LANGS = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
];

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
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const pollRef = useRef(null);
  const logEndRef = useRef(null);
  const currentRef = useRef(null); // assistant message id of the running analysis

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
    if (!code.trim() || busy) return;
    setBusy(true);

    const userId = ++idRef.current;
    const assistantId = ++idRef.current;
    const submittedCode = code;
    const submittedLang = language;

    setMessages((ms) => [
      ...ms,
      { id: userId, role: 'user', code: submittedCode, language: submittedLang },
      { id: assistantId, role: 'assistant', status: 'queued', result: null },
    ]);
    setCode('');
    currentRef.current = assistantId;

    try {
      const { job } = await createJob({ inputType: 'paste', inputRef: submittedCode, language: submittedLang });
      setActiveJobId(job.id);
      updateMsg(assistantId, { status: job.status });
      poll(job.id, assistantId);
      loadHistory();
    } catch (err) {
      updateMsg(assistantId, { status: 'failed', error: err.message });
      setBusy(false);
    }
  }

  async function openJob(jobId) {
    if (busy) return;
    clearInterval(pollRef.current);
    setActiveJobId(jobId);
    try {
      const { job, result } = await getJob(jobId);
      const uid = ++idRef.current;
      const aid = ++idRef.current;
      setMessages([
        { id: uid, role: 'user', code: job.inputRef, language: job.language || '' },
        { id: aid, role: 'assistant', status: job.status, result: result || null },
      ]);
    } catch { /* ignore */ }
  }

  function newChat() {
    clearInterval(pollRef.current);
    setMessages([]);
    setActiveJobId(null);
    setBusy(false);
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
      <aside className="sidebar">
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
              <span className="history-title">{firstLine(job.inputRef)}</span>
              <span className="history-meta">{job.language || '?'} · {job.status}</span>
            </button>
          ))}
        </div>
        <button className="secondary logout" onClick={onLogout}>Log out</button>
      </aside>

      <main className="main">
      <div className="chat">
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Logo size={72} />
              <p>Paste some code below and I'll hunt for bugs — then prove the fix by running it. 🐛</p>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? <UserMsg key={m.id} m={m} /> : <AgentMsg key={m.id} m={m} />,
          )}

          <div ref={logEndRef} />
        </div>

        <form className="chat-input" onSubmit={send}>
          <div className="chat-input-row">
            <LanguageSelect value={language} onChange={setLanguage} />
            <span className="muted" style={{ fontSize: '0.78rem' }}>Ctrl + Enter to send</span>
          </div>
          <div className="chat-input-box">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Paste your code here…"
              rows={4}
              spellCheck={false}
            />
            {busy ? (
              <button type="button" className="stop" onClick={cancel}>Stop</button>
            ) : (
              <button type="submit" disabled={!code.trim()}>Send</button>
            )}
          </div>
        </form>
      </div>
      </main>
    </div>
  );
}

function UserMsg({ m }) {
  return (
    <div className="msg user">
      <div className="bubble">
        <div className="msg-lang">{m.language}</div>
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
        {m.result ? <Result result={m.result} /> : <Thinking status={m.status} error={m.error} />}
      </div>
    </div>
  );
}

function Thinking({ status, error }) {
  if (status === 'failed') {
    return <p className="error" style={{ margin: 0 }}>❌ {error || 'Something went wrong.'}</p>;
  }
  if (status === 'canceled') {
    return <p className="muted" style={{ margin: 0 }}>Canceled.</p>;
  }
  const label = status === 'running' ? 'Analyzing your code…' : 'Queued…';
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

function Result({ result }) {
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
