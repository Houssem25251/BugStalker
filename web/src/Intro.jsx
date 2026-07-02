import { useEffect, useState } from 'react';
import Logo from './Logo';

// Cinematic splash:
//  1) logo (with glowing purple eyes) + name animate in
//  2) ghost + text + background fade to black, leaving only the glowing eyes
//  3) everything fades out -> login
// Click anywhere to skip.
export default function Intro({ onDone }) {
  const [eyesOnly, setEyesOnly] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setEyesOnly(true), 2900);
    const t2 = setTimeout(() => setLeaving(true), 4300);
    const t3 = setTimeout(onDone, 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  function skip() {
    setLeaving(true);
    setTimeout(onDone, 450);
  }

  return (
    <div className={`intro ${eyesOnly ? 'eyes-only' : ''} ${leaving ? 'leaving' : ''}`} onClick={skip}>
      <div className="intro-stage">
        <span className="intro-ping" />
        <span className="intro-ping delay" />
        <div className="intro-logo">
          <div className="intro-ghost">
            <Logo size={230} />
            <img className="ghost-eyes" src="/logo-eyes.png" width={230} alt="" />
          </div>
        </div>
      </div>
      <h1 className="intro-title">BugStalker</h1>
    </div>
  );
}
