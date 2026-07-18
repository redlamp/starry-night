import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Round a count to a friendly, obviously-approximate magnitude (~2 significant
// figures) — "~1,400" reads as an estimate, not a census. Used by the
// demographics report's Full City scope, where listed distributions are scaled
// up to the whole-city population.
export function approxCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n < 100) return Math.round(n / 5) * 5
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1)
  return Math.round(n / mag) * mag
}

// Inputs that never accept typed text. base-ui Slider thumbs carry a hidden
// `<input type="range">` that keeps focus after a drag — treating any INPUT as
// "typing" left every hotkey dead until the user clicked something focusable.
const NON_TEXT_INPUT_TYPES = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
])

// True when a keydown originates from (or focus sits in) a text-entry field, so
// global hotkey handlers can bail instead of firing while the user types.
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el =
    (e.target as HTMLElement | null) ??
    (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null)
  if (!el) return false
  const tag = el.tagName
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true
  if (tag !== "INPUT") return false
  return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)
}
