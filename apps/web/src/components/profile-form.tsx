"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { validateProfileInput } from "@/lib/profile";

export function ProfileForm({ name: initialName, email, company: initialCompany }: { name: string; email: string; company: string }) {
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState(initialCompany);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const profile = validateProfileInput({ name, company });
    if (!profile.ok) { setError(profile.error); return; }
    setPending(true);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile.data),
      });
      if (response.status === 401) { window.location.assign("/signin"); return; }
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error || "Could not save your profile. Please try again.");
        setPending(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Could not save your profile. Please try again.");
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError("Could not sign out. Please try again."); setPending(false); return; }
      window.location.assign("/signin");
    } catch {
      setError("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand" href="/"><span className="brand-mark">ll</span> ledgerline</Link>
    <div className="card">
      <span className="eyebrow">One last step</span>
      <h1>Make it yours.</h1>
      <p className="subtle">Confirm your details to finish setting up your workspace.</p>
      <form className="form" onSubmit={submit}>
        <label className="field-label" htmlFor="profile-email">Email address<input id="profile-email" className="input" type="email" value={email} readOnly /></label>
        <label className="field-label" htmlFor="profile-name">Full name<input id="profile-name" className="input" autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} /></label>
        <label className="field-label" htmlFor="profile-company"><span>Company <span className="optional">(optional)</span></span><input id="profile-company" className="input" autoComplete="organization" maxLength={120} placeholder="Your company or project" value={company} onChange={(event) => setCompany(event.target.value)} disabled={pending} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="button secondary" type="submit" disabled={pending}>{pending ? "Please wait…" : "Continue to dashboard"}</button>
      </form>
      <p className="subtle" style={{ marginBottom: 0 }}>Using a different account? <button className="text-button" type="button" disabled={pending} onClick={() => void signOut()}>Sign out</button></p>
    </div>
  </section></main>;
}
