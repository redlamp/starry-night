"use client";

import dynamic from "next/dynamic";
import { BookUser, History, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdle } from "@/lib/useIdle";
import { useSceneStore } from "@/lib/state/sceneStore";
import { DirectorySection, DirectoryBuildRing } from "@/components/ui/DirectoryPanel";
import { IconTip } from "@/components/ui/columns/EntityColumns";

// Recharts (~730 KB) only serves the demographics report, which self-gates on
// demographicsOpen (default false — see DemographicsPanel) and renders null
// until opened. Loading it via next/dynamic keeps that weight out of `/`'s
// first-load JS; the loading fallback is null (not a Skeleton) because the
// panel is itself invisible by default, so a visible placeholder here would
// be a new flash of UI that doesn't exist today.
const DemographicsPanel = dynamic(
  () => import("@/components/ui/demographics/DemographicsPanel").then((m) => m.DemographicsPanel),
  { ssr: false, loading: () => null },
);

// Top-left control dock (user 2026-07-08): [City Directory] [Inspect]
// [Resume]. Inspect moved here from bottom-right; the directory moved out of
// the settings drawer into its own toggle; Resume restores the last column
// stack after an empty-ground click dismissed it. Round buttons match the
// ControlsGuide "?" idiom (size / idle-fade / sticky-mode fill).
//
// (The Writing Lab button rode here 2026-07-12 → 2026-07-15; it now lives in
// Settings → Labs with the other workbench pages.)

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
    <IconTip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
          active
            ? "bg-primary text-primary-foreground border-transparent"
            : "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10",
          idleFade && !active ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
        )}
      >
        {children}
      </button>
    </IconTip>
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
        {/* Relative wrapper lets the build ring overlay the round button from
            outside DockButton's own IconTip/render composition (user
            2026-07-11: the panel-mounted ring is rarely seen since the panel
            is usually closed during the build). */}
        <span className="relative inline-flex">
          <DockButton
            active={directoryOpen}
            onClick={() => setDirectoryOpen(!directoryOpen)}
            label="City Directory"
            idleFade={idle}
          >
            <BookUser className="size-5" />
          </DockButton>
          <DirectoryBuildRing className="rounded-full" thickness={3} />
        </span>
        <DockButton
          active={inspectMode}
          onClick={() => setInspectMode(!inspectMode)}
          label="Inspect Buildings"
          idleFade={idle}
        >
          <Search className="size-5" />
        </DockButton>
        {canResume && (
          <DockButton onClick={resumeColumns} label="Resume Last Selection" idleFade={idle}>
            <History className="size-5" />
          </DockButton>
        )}
      </div>

      {directoryOpen && (
        <div
          // Fly-to framing avoids the space this panel covers (user 2026-07-11).
          data-camera-obstruction
          // Same glass recipe as the settings drawer (user 2026-07-18) — the
          // inspection cards (entity columns) keep their own solid chrome.
          // Same lower bound as the entity cards (user 2026-07-27): both stop
          // short of the seed chip so the project's seed stays readable at a
          // glance. See the max-h note in EntityColumns for the 8rem budget.
          className="border-foreground/10 bg-popover/70 text-popover-foreground pointer-events-auto fixed top-16 left-3 z-40 flex max-h-[calc(100vh-8rem)] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border shadow-lg backdrop-blur-md"
        >
          <DirectoryBuildRing />
          <div className="border-border/60 flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">City Directory</span>
            <button
              type="button"
              onClick={() => setDirectoryOpen(false)}
              aria-label="Close directory"
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
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

      {/* Floating, independent of the directory dock — self-gates on the
          demographicsOpen store flag (#97). */}
      <DemographicsPanel />
    </>
  );
}
