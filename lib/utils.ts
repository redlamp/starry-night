import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A capacity estimate displayed without fake precision (#96): "~185,500".
// Step scales with magnitude so the number reads as a census figure, not a count.
export function approxCount(n: number): string {
  const step = n >= 100_000 ? 5000 : n >= 10_000 ? 500 : n >= 1_000 ? 100 : 10
  return `~${(Math.round(n / step) * step).toLocaleString()}`
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
