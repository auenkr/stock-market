"use client";

import { useEffect, useState } from "react";

export function ThemePicker() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    try { setTheme(localStorage.getItem("ledgerline-theme") || "system"); } catch { /* System theme works without storage. */ }
  }, []);
  return <div className="theme-picker" role="group" aria-label="Color theme">{[{ value: "light", icon: "☀", label: "Light" }, { value: "dark", icon: "☾", label: "Dark" }, { value: "system", icon: "◐", label: "System" }].map(({ value, icon, label }) => <button key={value} type="button" title={`${label} theme`} aria-label={`${label} theme`} aria-pressed={theme === value} onClick={() => {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem("ledgerline-theme", value); } catch { /* Keep the current page preference. */ }
  }}><span aria-hidden="true">{icon}</span><span className="sr-only">{label}</span></button>)}</div>;
}
