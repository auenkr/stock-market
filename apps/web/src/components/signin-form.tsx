"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState<"email" | "google" | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending("email");
    try {
      const destination = mode === "signup" ? "/onboarding" : "/dashboard";
      const result = mode === "signin"
        ? await authClient.signIn.email({ email, password, callbackURL: destination })
        : await authClient.signUp.email({ name: name.trim(), email, password, callbackURL: destination });
      if (result.error) {
        setError(result.error.message || "Could not authenticate. Please try again.");
        setPending(null);
      } else {
        window.location.assign(destination);
      }
    } catch {
      setError("Could not connect. Please try again.");
      setPending(null);
    }
  }

  async function signInWithGoogle() {
    setError("");
    setPending("google");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
        newUserCallbackURL: "/onboarding",
        errorCallbackURL: "/signin",
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
    <Link className="brand" href="/"><span className="brand-mark">ll</span> ledgerline</Link>
    <div className="card">
      <span className="eyebrow">Developer console</span>
      <h1>{mode === "signin" ? "Welcome back." : "Start building."}</h1>
      <p className="subtle">{mode === "signin" ? "Sign in to manage your market data access." : "Create your workspace and issue your first API key."}</p>
      <button className="button google-button" type="button" disabled={!googleEnabled || pending !== null} onClick={() => void signInWithGoogle()}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.06.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.34-2.59Z" />
          <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96Z" />
        </svg>
        {pending === "google" ? "Connecting to Google…" : "Continue with Google"}
      </button>
      {!googleEnabled && <p className="auth-hint subtle">Google sign-in is currently unavailable. You can continue with email.</p>}
      <div className="auth-divider"><span>or continue with email</span></div>
      <form className="form" onSubmit={submit}>
        {mode === "signup" && <label className="field-label" htmlFor="signup-name">Full name<input id="signup-name" className="input" autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={pending !== null} /></label>}
        <label className="field-label" htmlFor="email">Email address<input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending !== null} /></label>
        <label className="field-label" htmlFor="password">Password<input id="password" className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required placeholder="8 or more characters" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending !== null} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="button secondary" type="submit" disabled={pending !== null}>{pending === "email" ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="subtle" style={{ marginBottom: 0 }}>{mode === "signin" ? "New here?" : "Already have an account?"} <button className="text-button" type="button" disabled={pending !== null} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>{mode === "signin" ? "Create an account" : "Sign in"}</button></p>
    </div>
  </section></main>;
}
