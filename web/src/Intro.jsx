import { useEffect, useState } from 'react';
import Logo from './Logo';

// Clean, minimal splash: logo + name fade in together, hold briefly,
// fade out to the login screen. Click anywhere to skip.
export default function Intro({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2100);
    const t2 = setTimeout(onDone, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  function skip() {
    setLeaving(true);
    setTimeout(onDone, 400);
  }

  return (
    <div className={`intro-clean ${leaving ? 'out' : ''}`} onClick={skip}>
      <Logo size={150} />
      <h1>BugStalker</h1>
    </div>
  );
}
