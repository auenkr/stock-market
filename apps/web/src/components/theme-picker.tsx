"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Monitor, Moon, Sun } from "lucide-react";

export function ThemePicker() {
  const [theme, setTheme] = useState("system");
  const [dark, setDark] = useState(false);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const current = document.documentElement.dataset.theme || "system";
      setTheme(current);
      setDark(current === "dark" || (current === "system" && media.matches));
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  async function toggle(button: HTMLButtonElement) {
    if (switching) return;
    const root = document.documentElement;
    const current = root.dataset.theme || "system";
    const isDark = current === "dark" || (current === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    const apply = () => {
      flushSync(() => { setTheme(next); setDark(!isDark); });
      root.dataset.theme = next;
      try { localStorage.setItem("ledgerline-theme", next); } catch { /* Keep the current page preference. */ }
    };
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      return;
    }
    const bounds = button.getBoundingClientRect();
    // Percentages keep the origin aligned with the button at any browser zoom.
    const x = (bounds.left + bounds.width / 2) / innerWidth * 100;
    const y = (bounds.top + bounds.height / 2) / innerHeight * 100;
    setSwitching(true);
    root.classList.add("theme-transition");
    const transition = document.startViewTransition(apply);
    try {
      await transition.ready;
      // 145% exceeds the full diagonal, even when the origin is in a corner.
      // A steady expansion avoids a slow edge followed by a final-page flash.
      await root.animate({ clipPath: [`circle(0% at ${x}% ${y}%)`, `circle(145% at ${x}% ${y}%)`] }, {
        duration: 600, easing: "linear", fill: "both", pseudoElement: "::view-transition-new(root)",
      }).finished;
      await transition.finished;
    } catch {
      transition.skipTransition();
    } finally {
      root.classList.remove("theme-transition");
      setSwitching(false);
    }
  }
  const Icon = theme === "system" ? Monitor : dark ? Moon : Sun;
  const label = `${theme === "system" ? "System theme. " : ""}Switch to ${dark ? "light" : "dark"} mode`;
  return <div className="theme-picker"><button type="button" title={label} aria-label={label} aria-busy={switching} disabled={switching} onClick={(event) => { void toggle(event.currentTarget); }}><Icon size={18} aria-hidden="true" /></button></div>;
}
