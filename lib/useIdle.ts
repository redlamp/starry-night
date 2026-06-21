import { useEffect, useState } from "react";

// Shared "user has gone idle" signal — true after IDLE_FADE_MS with no input (pointer / key / wheel /
// touch), false again on the next input. Used to fade the persistent chrome (the Settings + Controls
// buttons) so an unattended app reads like a screensaver. A single module-level tracker drives every
// consumer (one set of window listeners, one timer), so the buttons fade in unison and high-frequency
// pointermove doesn't attach duplicate listeners. Display-only (not scene state).
export const IDLE_FADE_MS = 5000; // matches the seed bar's collapse delay (SeedControls COLLAPSE_MS)

let timer: ReturnType<typeof setTimeout> | undefined;
let idleNow = false;
let started = false;
const subscribers = new Set<(idle: boolean) => void>();

function broadcast(next: boolean) {
  if (next === idleNow) return;
  idleNow = next;
  for (const fn of subscribers) fn(next);
}

function wake() {
  broadcast(false);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => broadcast(true), IDLE_FADE_MS);
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  for (const e of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(e, wake, { passive: true });
  }
  timer = setTimeout(() => broadcast(true), IDLE_FADE_MS);
}

export function useIdle(): boolean {
  const [idle, setIdle] = useState(idleNow);
  useEffect(() => {
    ensureStarted();
    subscribers.add(setIdle);
    return () => {
      subscribers.delete(setIdle);
    };
  }, []);
  return idle;
}
