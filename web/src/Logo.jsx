// The BugStalker mark — your ghost (web/public/logo.png), inverted so the dark
// silhouette shows up on the dark theme.
export default function Logo({ size = 120 }) {
  return (
    <img
      src="/logo.png"
      width={size}
      alt="BugStalker logo"
      style={{ filter: 'invert(1)', display: 'block', height: 'auto' }}
    />
  );
}
