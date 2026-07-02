// The BugStalker mark — your ghost (web/public/logo.png).
// Color comes from CSS (.logo-img): white on the dark theme (inverted),
// black on the light theme. The intro always keeps it white.
export default function Logo({ size = 120 }) {
  return (
    <img
      src="/logo.png"
      width={size}
      alt="BugStalker logo"
      className="logo-img"
      style={{ display: 'block', height: 'auto' }}
    />
  );
}
