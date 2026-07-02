import { useState } from 'react';
import { login, signup, setToken } from './api';
import Logo from './Logo';

// Login / signup: a big square modal — logo centered on the left half,
// form centered on the right half.
export default function AuthForm({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (isSignup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    try {
      const data = isSignup ? await signup(email, password, phone) : await login(email, password);
      setToken(data.token);
      onAuthed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isSignup ? 'login' : 'signup');
    setError('');
    setConfirm('');
    setPhone('');
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-left">
          <span className="modal-logo-glow">
            <Logo size={240} />
          </span>
        </div>

        <div className="modal-right">
          <div className="modal-form">
            <form onSubmit={submit}>
              <input
                className="field"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              {isSignup && (
                <input
                  className="field"
                  type="tel"
                  placeholder="Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              )}

              <input
                className="field"
                type="password"
                placeholder="Password (min 8 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />

              {isSignup && (
                <input
                  className="field"
                  type="password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              )}

              {error && <p className="error">{error}</p>}

              <button type="submit" className="block" disabled={busy}>
                {busy ? 'Please wait…' : isSignup ? 'Sign up' : 'Log in'}
              </button>
            </form>

            <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
              {isSignup ? 'Have an account? ' : 'No account? '}
              <button type="button" className="ghost" onClick={switchMode}>
                {isSignup ? 'Log in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
