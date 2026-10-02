"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "Could not log out.");
      window.location.replace("/signin");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not log out. Please try again.");
      setPending(false);
    }
  }
  return <div className="logout-action"><button type="button" className="button logout-button" disabled={pending} onClick={() => { void logout(); }}><LogOut size={14} aria-hidden="true" />{pending ? "Logging out…" : "Log out"}</button>{error && <p className="error" role="alert">{error}</p>}</div>;
}
