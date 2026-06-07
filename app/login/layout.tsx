// Auth split layout — sets body.auth's grid via a wrapper since we can't put
// the class on <body> per-route. The .auth grid styles live in globals.css;
// applied here through a wrapping element that mirrors the grid.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell">{children}</div>;
}
