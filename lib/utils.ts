import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// True when a keydown originates from (or focus sits in) a text-entry field, so
// global hotkey handlers can bail instead of firing while the user types.
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el =
    (e.target as HTMLElement | null) ??
    (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null)
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}
