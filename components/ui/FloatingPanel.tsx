"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Reusable floating window (#97): title-bar drag + corner resize, no external
// deps — just pointer events. Viewport-clamped, min-size clamped, sits above
// the top-left docks (z-50 vs the docks' z-40). Escape closes. Position/size
// live in local component state and are NOT persisted (phase 1) — reopening
// starts from the default placement.

const MARGIN = 8; // px kept between the panel and the viewport edge

type Point = { x: number; y: number };
type Size = { w: number; h: number };

// A gesture in flight: what the pointer grabbed plus the panel geometry +
// pointer position captured at grab time, so moves apply as a delta.
type Drag = {
  mode: "move" | "resize";
  startPointer: Point;
  startPos: Point;
  startSize: Size;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function FloatingPanel({
  title,
  onClose,
  children,
  className,
  defaultWidth = 380,
  defaultHeight = 560,
  minWidth = 300,
  minHeight = 260,
  headerRight,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  headerRight?: React.ReactNode;
}) {
  const [size, setSize] = useState<Size>({ w: defaultWidth, h: defaultHeight });
  // null until the first client layout effect places it (needs window dims).
  const [pos, setPos] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Initial placement + clamp to the current viewport. Runs once on mount and
  // again on resize so the window can't strand itself off-screen.
  useEffect(() => {
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(size.w, vw - MARGIN * 2);
      const h = Math.min(size.h, vh - MARGIN * 2);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
      setPos((p) => {
        // First placement: near the top-left docks but clear of them.
        const base = p ?? { x: 76, y: 64 };
        return {
          x: clamp(base.x, MARGIN, Math.max(MARGIN, vw - w - MARGIN)),
          y: clamp(base.y, MARGIN, Math.max(MARGIN, vh - h - MARGIN)),
        };
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // size.w/h intentionally omitted: this effect owns clamping, re-running it
    // on its own setSize would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // While a gesture is live, the window owns pointer tracking (so it survives
  // the pointer leaving the small grip) — the effect attaches the listeners
  // and cleans them up on pointer-up or unmount. Deltas apply against the
  // geometry snapshotted at grab time, held in `drag`.
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - drag.startPointer.x;
      const dy = ev.clientY - drag.startPointer.y;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (drag.mode === "move") {
        setPos({
          x: clamp(drag.startPos.x + dx, MARGIN, Math.max(MARGIN, vw - drag.startSize.w - MARGIN)),
          y: clamp(drag.startPos.y + dy, MARGIN, Math.max(MARGIN, vh - drag.startSize.h - MARGIN)),
        });
      } else {
        setSize({
          w: clamp(drag.startSize.w + dx, minWidth, vw - drag.startPos.x - MARGIN),
          h: clamp(drag.startSize.h + dy, minHeight, vh - drag.startPos.y - MARGIN),
        });
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, minWidth, minHeight]);

  const beginDrag = (mode: Drag["mode"]) => (e: React.PointerEvent) => {
    if (!pos || e.button !== 0) return;
    e.preventDefault();
    setDrag({
      mode,
      startPointer: { x: e.clientX, y: e.clientY },
      startPos: pos,
      startSize: size,
    });
  };

  if (!pos) return null;

  return (
    <div
      data-camera-obstruction
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        // /75 + blur-xl: at /95 the backdrop blur was imperceptible and the
        // panel read as a flat card over the scene (user 2026-07-18).
        "pointer-events-auto fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover/75 text-popover-foreground shadow-2xl backdrop-blur-xl",
        className,
      )}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div
        onPointerDown={beginDrag("move")}
        className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-2 border-b border-border/60 px-3 py-2 select-none active:cursor-grabbing"
      >
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          {headerRight}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

      {/* Bottom-right resize grip. */}
      <div
        onPointerDown={beginDrag("resize")}
        aria-hidden
        className="absolute right-0 bottom-0 z-10 size-4 cursor-nwse-resize touch-none"
        style={{
          background:
            "linear-gradient(135deg, transparent 0 50%, color-mix(in oklab, var(--muted-foreground) 55%, transparent) 50% 60%, transparent 60% 70%, color-mix(in oklab, var(--muted-foreground) 55%, transparent) 70% 80%, transparent 80%)",
        }}
      />
    </div>
  );
}
