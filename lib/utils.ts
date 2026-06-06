import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
