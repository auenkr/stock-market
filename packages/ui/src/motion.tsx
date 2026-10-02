"use client";

import { useEffect } from "react";

/** Progressive enhancement: server-rendered content stays visible without JS. */
export function PageMotion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let generation = 0;
    let cleanups: (() => void)[] = [];

    function reset() {
      cleanups.forEach((cleanup) => cleanup());
      cleanups = [];
      root!.querySelectorAll<HTMLElement>("[data-reveal], [data-motion-card]").forEach((element) => {
        element.style.removeProperty("opacity");
        element.style.removeProperty("transform");
      });
      root!.querySelectorAll<HTMLElement>("[data-motion-code]").forEach((element) => {
        ["--code-rotate-x", "--code-rotate-y", "--code-shift-x", "--code-shift-y"].forEach((property) => element.style.removeProperty(property));
        element.closest<HTMLElement>(".product-code-scene")?.style.removeProperty("--scene-x");
        element.closest<HTMLElement>(".product-code-scene")?.style.removeProperty("--scene-y");
      });
    }

    async function start() {
      const currentGeneration = ++generation;
      reset();
      if (preference.matches || disposed) return;
      const { animate, hover, inView, stagger } = await import("motion");
      if (preference.matches || disposed || currentGeneration !== generation) return;
      const reveal = (elements: HTMLElement[], delay = 0) => {
        if (!elements.length) return;
        const animation = animate(elements, { opacity: [0, 1], y: [18, 0] }, {
          duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: stagger(0.075, { startDelay: delay }),
        });
        cleanups.push(() => animation.stop());
      };
      reveal([...root!.querySelectorAll<HTMLElement>("[data-motion-hero] [data-reveal]")]);
      root!.querySelectorAll<HTMLElement>("[data-motion-section]").forEach((section) => {
        let revealed = false;
        cleanups.push(inView(section, () => {
          if (revealed) return;
          revealed = true;
          reveal([...section.querySelectorAll<HTMLElement>("[data-reveal]")]);
        }, { margin: "0px 0px -40px 0px", amount: 0.15 }));
      });
      cleanups.push(hover(root!.querySelectorAll<HTMLElement>("[data-motion-card]"), (element) => {
        const lift = animate(element, { y: -5 }, { type: "spring", stiffness: 260, damping: 22 });
        cleanups.push(() => lift.stop());
        return () => {
          const settle = animate(element, { y: 0 }, { type: "spring", stiffness: 260, damping: 22 });
          cleanups.push(() => settle.stop());
        };
      }));
      root!.querySelectorAll<HTMLElement>("[data-motion-code]").forEach((element) => {
        const scene = element.closest<HTMLElement>(".product-code-scene") ?? element;
        const clear = () => {
          ["--code-rotate-x", "--code-rotate-y", "--code-shift-x", "--code-shift-y"].forEach((property) => element.style.removeProperty(property));
          scene.style.removeProperty("--scene-x");
          scene.style.removeProperty("--scene-y");
        };
        const move = (event: PointerEvent) => {
          if (event.pointerType !== "mouse") return;
          const bounds = scene.getBoundingClientRect();
          const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
          const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
          element.style.setProperty("--code-rotate-x", `${-y * 5}deg`);
          element.style.setProperty("--code-rotate-y", `${x * 6}deg`);
          element.style.setProperty("--code-shift-x", `${x * 5}px`);
          element.style.setProperty("--code-shift-y", `${y * 5 - 5}px`);
          scene.style.setProperty("--scene-x", `${x * 10}px`);
          scene.style.setProperty("--scene-y", `${y * 8}px`);
        };
        scene.addEventListener("pointermove", move);
        scene.addEventListener("pointerleave", clear);
        cleanups.push(() => {
          scene.removeEventListener("pointermove", move);
          scene.removeEventListener("pointerleave", clear);
          clear();
        });
      });
    }
    const onChange = () => { void start(); };
    void start();
    preference.addEventListener("change", onChange);
    return () => { disposed = true; preference.removeEventListener("change", onChange); reset(); };
  }, [rootId]);

  return null;
}
