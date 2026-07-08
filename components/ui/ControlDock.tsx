"use client";

import { BookUser, History, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdle } from "@/lib/useIdle";
import { useSceneStore } from "@/lib/state/sceneStore";
import { DirectorySection } from "@/components/ui/DirectoryPanel";

// Top-left control dock (user 2026-07-08): [City Directory] [Inspect]
// [Resume]. Inspect moved here from bottom-right; the directory moved out of
// the settings drawer into its own toggle; Resume restores the last column
// stack after an empty-ground click dismissed it. Round buttons match the
// ControlsGuide "?" idiom (size / idle-fade / sticky-mode fill).

function DockButton({
  active,
  onClick,
  label,
  idleFade,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  idleFade: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10",
        idleFade && !active ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
      )}
    >
      {children}
    </button>
  );
}

export function ControlDock() {
  const inspectMode = useSceneStore((s) => s.inspectMode);
  const setInspectMode = useSceneStore((s) => s.setInspectMode);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const lastColumnPath = useSceneStore((s) => s.lastColumnPath);
  const resumeColumns = useSceneStore((s) => s.resumeColumns);
  const captureMode = useSceneStore((s) => s.captureMode);
  const idle = useIdle();
  const directoryOpen = useSceneStore((s) => s.directoryOpen);
  const setDirectoryOpen = useSceneStore((s) => s.setDirectoryOpen);

  if (captureMode) return null;
  const canResume = columnCursor < 0 && lastColumnPath.length > 0;

  return (
    <>
      <div className="pointer-events-auto fixed top-3 left-3 z-40 flex items-center gap-1.5">
        <DockButton
          active={directoryOpen}
          onClick={() => setDirectoryOpen(!directoryOpen)}
          label="City Directory"
          idleFade={idle}
        >
          <BookUser className="size-5" />
        </DockButton>
        <DockButton
          active={inspectMode}
          onClick={() => setInspectMode(!inspectMode)}
          label="Inspect buildings"
          idleFade={idle}
        >
          <Search className="size-5" />
        </DockButton>
        {canResume && (
          <DockButton onClick={resumeColumns} label="Resume last selection" idleFade={idle}>
            <History className="size-5" />
          </DockButton>
        )}
      </div>

      {directoryOpen && (
        <div className="pointer-events-auto fixed top-16 left-3 z-40 flex max-h-[calc(100vh-5.5rem)] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-sm font-medium">City Directory</span>
            <button
              type="button"
              onClick={() => setDirectoryOpen(false)}
              aria-label="Close directory"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          {/* The section manages its own inner scroll (district tree); this
              wrapper just grows to content up to the viewport cap. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pr-3">
            <DirectorySection />
          </div>
        </div>
      )}
    </>
  );
}
