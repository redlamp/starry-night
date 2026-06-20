"use client";

// Persistent survey state for the Camera Lab. Ratings (1-5) per method across a
// fixed set of dimensions, free-text notes per method, and a global notes field.
// Persists to localStorage so it survives sessions; SurveyPanel exports it as JSON
// (copy / download) for import + review.

import { useCallback, useEffect, useState } from "react";

export const DIMENSIONS = [
  { key: "rotate", label: "Rotate feel" },
  { key: "tilt", label: "Tilt feel" },
  { key: "zoom", label: "Zoom" },
  { key: "pan", label: "Pan" },
  { key: "precision", label: "Precision" },
  { key: "learnability", label: "Learnability" },
  { key: "comfort", label: "Comfort (no fight/nausea)" },
  { key: "overall", label: "Overall" },
] as const;

export type MethodFeedback = { ratings: Record<string, number>; notes: string };
export type Feedback = { byMethod: Record<string, MethodFeedback>; globalNotes: string };

const KEY = "camera-lab.feedback";
const EMPTY: Feedback = { byMethod: {}, globalNotes: "" };

function save(fb: Feedback) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(fb));
  } catch {
    // best effort
  }
}

export function useLabFeedback() {
  const [fb, setFb] = useState<Feedback>(EMPTY);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted feedback after mount; first render stays empty so the static-export prerender doesn't mismatch
      if (raw) setFb(JSON.parse(raw) as Feedback);
    } catch {
      // empty is a fine default
    }
  }, []);

  const setRating = useCallback((id: string, dim: string, v: number) => {
    setFb((prev) => {
      const m = prev.byMethod[id] ?? { ratings: {}, notes: "" };
      const cleared = m.ratings[dim] === v; // click the active value again -> clear
      const next: Feedback = {
        ...prev,
        byMethod: {
          ...prev.byMethod,
          [id]: { ...m, ratings: { ...m.ratings, [dim]: cleared ? 0 : v } },
        },
      };
      save(next);
      return next;
    });
  }, []);

  const setNotes = useCallback((id: string, text: string) => {
    setFb((prev) => {
      const m = prev.byMethod[id] ?? { ratings: {}, notes: "" };
      const next: Feedback = {
        ...prev,
        byMethod: { ...prev.byMethod, [id]: { ...m, notes: text } },
      };
      save(next);
      return next;
    });
  }, []);

  const setGlobalNotes = useCallback((text: string) => {
    setFb((prev) => {
      const next: Feedback = { ...prev, globalNotes: text };
      save(next);
      return next;
    });
  }, []);

  return { fb, setRating, setNotes, setGlobalNotes };
}
