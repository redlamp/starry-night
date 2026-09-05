"use client";

import { Trash2, Plus, Camera as CameraIcon, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconTip } from "@/components/ui/columns/EntityColumns";
import { cn } from "@/lib/utils";
import type { MoveKind, VignetteShot } from "@/lib/vignette/shotList";

const MOVE_LABELS: Record<MoveKind, string> = {
  static: "Static",
  "push-in": "Push In",
  drift: "Drift",
  orbit: "Orbit",
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconTip label={label}>
      <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
        {children}
      </Button>
    </IconTip>
  );
}

// Shot list table (index / label / McCloud transition / hold / move), one row
// per shot. No shadcn <Table> exists in this repo (grepped) — a plain
// bordered grid matches the density of the other lab panels well enough.
export function ShotTable({
  shots,
  activeIndex,
  onSelect,
  onChangeHold,
  onChangeMove,
  onCapturePose,
  onCopyLink,
  onDelete,
  onAddAfter,
}: {
  shots: VignetteShot[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onChangeHold: (index: number, holdSec: number) => void;
  onChangeMove: (index: number, move: MoveKind) => void;
  onCapturePose: (index: number) => void;
  onCopyLink: (index: number) => void;
  onDelete: (index: number) => void;
  onAddAfter: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {shots.map((shot, i) => (
        <div
          key={shot.id}
          onClick={() => onSelect(i)}
          className={cn(
            "flex cursor-pointer flex-col gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
            i === activeIndex
              ? "border-primary/60 bg-primary/10"
              : "border-border/60 hover:bg-muted/40",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-4 shrink-0 font-mono tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{shot.label}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              {shot.transitionIn === "cut" ? "cut" : `move ${shot.transitionSec ?? ""}s`}
            </span>
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="bg-muted rounded px-1 py-0.5">{shot.mccloud}</span>
            <span>hold</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={shot.holdSec}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onChangeHold(i, Math.max(0.5, parseFloat(e.target.value) || 0.5))}
              className="border-input bg-background text-foreground w-14 rounded border px-1 py-0.5 font-mono"
            />
            <span>s</span>
            <div onClick={(e) => e.stopPropagation()} className="ml-1">
              <Select value={shot.move} onValueChange={(v) => onChangeMove(i, v as MoveKind)}>
                <SelectTrigger size="sm" className="h-6 px-1.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MOVE_LABELS) as MoveKind[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MOVE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span
              className="ml-auto flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <IconButton label="Capture Pose From Camera" onClick={() => onCapturePose(i)}>
                <CameraIcon />
              </IconButton>
              <IconButton label="Copy Link" onClick={() => onCopyLink(i)}>
                <LinkIcon />
              </IconButton>
              <IconButton label="Add Shot After" onClick={() => onAddAfter(i)}>
                <Plus />
              </IconButton>
              <IconButton label="Delete" onClick={() => onDelete(i)}>
                <Trash2 />
              </IconButton>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
