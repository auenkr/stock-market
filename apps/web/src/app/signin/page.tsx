"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const result = mode === "signin" ? await authClient.signIn.email({ email, password, callbackURL: "/dashboard" }) : await authClient.signUp.email({ name, email, password, callbackURL: "/dashboard" });
    if (result.error) setError(result.error.message || "Could not authenticate"); else window.location.href = "/dashboard";
  }
  return <main className="auth-page"><section className="auth-card"><Link className="brand" href="/"><span className="brand-mark">ll</span> ledgerline</Link><div className="card"><span className="eyebrow">Developer console</span><h1>{mode === "signin" ? "Welcome back." : "Start building."}</h1><p className="subtle">{mode === "signin" ? "Sign in to manage your market data access." : "Create your workspace and issue your first API key."}</p><form className="form" onSubmit={submit}>{mode === "signup" && <input className="input" required placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} />}<input className="input" type="email" required placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} /><input className="input" type="password" minLength={8} required placeholder="Password (8+ characters)" value={password} onChange={(event) => setPassword(event.target.value)} />{error && <div className="error">{error}</div>}<button className="button secondary" type="submit">{mode === "signin" ? "Sign in" : "Create account"}</button></form><p className="subtle" style={{ marginBottom: 0 }}>{mode === "signin" ? "New here?" : "Already have an account?"} <button style={{ border: 0, background: "none", padding: 0, color: "#28724b", cursor: "pointer" }} onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Create an account" : "Sign in"}</button></p></div></section></main>;
}
