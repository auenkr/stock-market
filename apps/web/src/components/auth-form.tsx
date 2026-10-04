"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode, googleEnabled, devEnabled = false, initialError = "", destination = "/dashboard", oauth = false }: {
  mode: "login" | "signup";
  googleEnabled: boolean;
  devEnabled?: boolean;
  initialError?: string;
  destination?: string;
  oauth?: boolean;
}) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState<"google" | "dev" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const isLogin = mode === "login";
  const onboarding = destination === "/dashboard/billing" ? "/onboarding?next=/dashboard/billing" : "/onboarding";

  async function signInDev(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending("dev");
    try {
      const result = await authClient.signIn.email({
        email: `${username.trim().toLowerCase()}@auenkr.com`, password, callbackURL: destination,
      });
      if (result.error) {
        setError(result.error.message || "Could not sign in.");
        setPending(null);
      } else window.location.assign(oauth ? (result.data as { url?: string } | null)?.url || window.location.href : destination);
    } catch {
      setError("Could not connect. Please try again.");
      setPending(null);
    }
  }

  async function continueWithGoogle() {
    setError("");
    if (!isLogin && !accepted) { setError("Please agree to the Terms of Service and Privacy Policy."); return; }
    setPending("google");
    try {
      if (!isLogin) {
        const response = await fetch("/api/legal/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted }) });
        if (!response.ok) throw new Error("Consent could not be recorded");
      }
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: oauth ? window.location.href : isLogin ? destination : onboarding,
        newUserCallbackURL: oauth ? window.location.href : onboarding,
        errorCallbackURL: isLogin ? "/signin" : "/signup",
      });
      if (result.error) {
        setError(result.error.message || "Google sign-in could not be completed. Please try again.");
        setPending(null);
      }
    } catch {
      setError("Could not connect to Google. Please try again.");
      setPending(null);
    }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link>
    <div className="card">
      <span className="eyebrow">Developer console</span>
      <h1>{oauth ? "Connect Ledgerline." : isLogin ? "Welcome back." : "Start building."}</h1>
      <p className="subtle">{oauth ? "Sign in to connect your Ledgerline account to ChatGPT. You will review the requested access before connecting." : isLogin ? "Sign in to manage your market data access." : "Create your workspace and issue your first API key."}</p>
      {!isLogin && <label className="legal-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={!ready || pending !== null} /><span>I agree to the <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</Link> and <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.</span></label>}
      <button className="button google-button" type="button" disabled={!googleEnabled || pending !== null || (!isLogin && !accepted)} onClick={() => void continueWithGoogle()}>
        <GoogleMark />{pending === "google" ? "Connecting to Google…" : isLogin || oauth ? "Continue with Google" : "Sign up with Google"}
      </button>
      {!googleEnabled && <p className="auth-hint subtle">Google authentication is currently unavailable.</p>}
      {devEnabled && (isLogin || oauth) && <>
        <div className="auth-divider"><span>Development login</span></div>
        <form className="form" onSubmit={signInDev}>
          <label className="field-label" htmlFor="dev-username">Username<input id="dev-username" className="input" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending !== null} /></label>
          <label className="field-label" htmlFor="dev-password">Password<input id="dev-password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending !== null} /></label>
          <button className="button secondary" type="submit" disabled={pending !== null}>{pending === "dev" ? "Signing in…" : "Sign in with password"}</button>
        </form>
      </>}
      {error && <div className="error" role="alert">{error}</div>}
      {!oauth && <p className="subtle" style={{ marginBottom: 0 }}>{isLogin ? "New here?" : "Already have an account?"} <Link className="text-button" href={`${isLogin ? "/signup" : "/signin"}${destination === "/dashboard/billing" ? "?next=/dashboard/billing" : ""}`}>{isLogin ? "Create an account" : "Sign in"}</Link></p>}
    </div>
  </section></main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.06.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.34-2.59Z" />
    <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96Z" />
  </svg>;
}
