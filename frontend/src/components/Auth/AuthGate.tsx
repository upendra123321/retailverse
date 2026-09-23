import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { fetchAuthStatus, login, logout } from "../../api/client";

interface Props {
  children: ReactNode;
}

type Phase = "checking" | "locked" | "unlocked" | "error";

/** Gates the entire app behind a single shared team passcode - see
 * backend/app/security.py "Simple shared-passcode authentication" for the
 * server side. Deliberately NOT per-user accounts (this is a hackathon demo
 * with a shared persona library, not a multi-tenant product) - see
 * SECURITY.md's "Authorization model" for the reasoning.
 *
 * If the backend hasn't been configured with APP_ACCESS_CODE (the default,
 * e.g. local dev), /api/auth/status reports auth_required=false and this
 * renders children immediately with zero friction - identical to before
 * this feature existed.
 */
export function AuthGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        setAuthRequired(status.auth_required);
        setPhase(status.authenticated ? "unlocked" : "locked");
      })
      .catch(() => {
        // If the status check itself fails (backend unreachable), fail
        // open rather than stranding the user on a login screen they can
        // never pass - the app's own data calls will surface the real error.
        setPhase("unlocked");
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await login(code);
      setPhase("unlocked");
      setCode("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    void logout().finally(() => {
      setPhase("locked");
      setCode("");
    });
  }

  if (phase === "checking") {
    return <div className="auth-gate-checking">Loading RetailVerse…</div>;
  }

  if (phase === "locked") {
    return (
      <div className="auth-gate-overlay">
        <form className="auth-gate-panel" onSubmit={handleSubmit}>
          <h1>RetailVerse</h1>
          <p className="auth-gate-subtitle">Enter the team passcode to continue.</p>
          <input
            type="password"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Passcode"
            required
          />
          {formError && <p className="auth-gate-error">{formError}</p>}
          <button type="submit" disabled={submitting || !code}>
            {submitting ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {children}
      {authRequired && (
        <button className="auth-gate-logout" onClick={handleLogout} title="Sign out">
          Sign out
        </button>
      )}
    </>
  );
}
