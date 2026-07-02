import { useState } from 'react';
import { getToken, clearToken } from './api';
import Intro from './Intro';
import AuthForm from './AuthForm';
import Analyze from './Analyze';

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const [introDone, setIntroDone] = useState(false);

  if (!token && !introDone) {
    return <Intro onDone={() => setIntroDone(true)} />;
  }
  if (!token) {
    return <AuthForm onAuthed={() => setTokenState(getToken())} />;
  }

  return <Analyze onLogout={() => { clearToken(); setTokenState(null); }} />;
}
