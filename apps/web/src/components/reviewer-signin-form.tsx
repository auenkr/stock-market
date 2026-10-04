"use client";

import { useState } from "react";
import { Button } from "@stock-market/ui/components/button";
import { Input } from "@stock-market/ui/components/input";
import { Label } from "@stock-market/ui/components/label";
import { authClient } from "@/lib/auth-client";

export function ReviewerSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password, callbackURL: "/dashboard" });
      if (result.error) {
        setError("Could not sign in. Check your email and password.");
        setPending(false);
      } else window.location.assign("/dashboard");
    } catch {
      setError("Could not connect. Please try again.");
      setPending(false);
    }
  }

  return <main className="auth-page"><section className="auth-card card">
    <span className="eyebrow">Ledgerline</span>
    <h1>Reviewer sign in</h1>
    <p className="subtle">Use the account provided with your review instructions.</p>
    <form className="form" onSubmit={submit}>
      <div className="space-y-2"><Label htmlFor="reviewer-email">Email address</Label><Input id="reviewer-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor="reviewer-password">Password</Label><Input id="reviewer-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} /></div>
      {error && <p role="alert" className="error">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  </section></main>;
}
