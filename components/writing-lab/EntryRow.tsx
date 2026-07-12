"use client";

import { useRef, useState } from "react";
import { Copy, Pencil, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Authorship, EntryMeta, ReviewStatus } from "@/lib/writing/labStore";
import {
  AUTHOR_DOT_CLASS,
  AUTHOR_LABEL,
  AUTHOR_OPTIONS,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  effectiveText,
} from "./labHelpers";

function AuthorSelect({ value, onChange }: { value: Authorship; onChange: (v: Authorship) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Authorship)}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue>
          {(v: Authorship) => (
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 shrink-0 rounded-full", AUTHOR_DOT_CLASS[v])} aria-hidden />
              {AUTHOR_LABEL[v]}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {AUTHOR_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span
              className={cn("size-1.5 shrink-0 rounded-full", AUTHOR_DOT_CLASS[opt.value])}
              aria-hidden
            />
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusSelect({ value, onChange }: { value: ReviewStatus; onChange: (v: ReviewStatus) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ReviewStatus)}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue>
          {(v: ReviewStatus) => (
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[v])} aria-hidden />
              {STATUS_LABEL[v]}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span
              className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[opt.value])}
              aria-hidden
            />
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EntryRow({
  id,
  index,
  entryId,
  isAdded,
  sourceText,
  meta,
  flash,
  checked,
  onCheckedChange,
  onSaveText,
  onRevertText,
  onAuthorChange,
  onStatusChange,
  onDuplicate,
  onDelete,
}: {
  id: string;
  // null for a locally-added ("Duplicate") row — it has no source position.
  index: number | null;
  entryId: string;
  isAdded: boolean;
  sourceText: string | null;
  meta: EntryMeta;
  flash: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSaveText: (text: string) => void;
  onRevertText: () => void;
  onAuthorChange: (author: Authorship) => void;
  onStatusChange: (status: ReviewStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Guards against committing twice for one edit: Enter fires commit(), which
  // sets isEditing false, which unmounts the textarea — that unmount can also
  // deliver a native blur the onBlur handler would otherwise turn into a
  // second commit() with the same value.
  const committedRef = useRef(false);

  const text = effectiveText(meta, sourceText ?? "");
  // An added row's `text` IS the entry (no source counterpart to be "modified
  // relative to"); only a source-backed row can be modified.
  const isModified = !isAdded && meta.text !== undefined;
  const isCut = meta.status === "cut";

  function startEdit() {
    setDraft(text);
    committedRef.current = false;
    setIsEditing(true);
  }

  function commit(value: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    setIsEditing(false);
    if (!isAdded && value === sourceText) {
      if (isModified) onRevertText();
    } else if (value !== text) {
      onSaveText(value);
    }
  }

  function cancel() {
    committedRef.current = true;
    setIsEditing(false);
  }

  return (
    <tr
      id={id}
      className={cn(
        "group border-b border-border transition-colors duration-700 hover:bg-muted/40",
        isCut && "opacity-60",
        flash && "bg-accent/60",
      )}
    >
      <td className="px-2 py-2 align-top">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          aria-label={`Select entry ${entryId}`}
          className="size-3.5 cursor-pointer accent-primary"
        />
      </td>
      <td className="px-2 py-2 text-right align-top text-xs tabular-nums text-muted-foreground">
        {index === null ? "+" : index}
      </td>
      <td className="min-w-0 px-2 py-2 align-top">
        <Badge
          variant="outline"
          className="mb-1 font-mono text-[10px] font-normal text-muted-foreground select-all"
        >
          {entryId}
        </Badge>
        {isEditing ? (
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="w-full resize-none rounded-md border border-ring bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={startEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") startEdit();
            }}
            className={cn(
              "cursor-text rounded-md px-2 py-1 text-sm whitespace-pre-wrap",
              isCut ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {text}
          </div>
        )}
        {isAdded && !isEditing && (
          <div className="flex items-center gap-1 px-2 pt-0.5 text-xs text-muted-foreground">
            <Copy className="size-3" aria-hidden />
            New — duplicated, not yet shippable
          </div>
        )}
        {isModified && !isEditing && (
          <div className="flex items-center gap-1 px-2 pt-0.5 text-xs text-muted-foreground">
            <Pencil className="size-3" aria-hidden />
            Modified
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <AuthorSelect value={meta.author} onChange={onAuthorChange} />
      </td>
      <td className="px-2 py-2 align-top">
        <StatusSelect value={meta.status} onChange={onStatusChange} />
      </td>
      <td className="px-1 py-2 align-top">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {isModified && !isEditing && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-xs" onClick={onRevertText} />}
              >
                <RotateCcw />
                <span className="sr-only">Revert</span>
              </TooltipTrigger>
              <TooltipContent>Revert</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={onDuplicate} />}>
              <Copy />
              <span className="sr-only">Duplicate</span>
            </TooltipTrigger>
            <TooltipContent>Duplicate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={onDelete} />}>
              <Trash2 />
              <span className="sr-only">{isAdded ? "Delete" : "Cut"}</span>
            </TooltipTrigger>
            <TooltipContent>{isAdded ? "Delete" : "Cut"}</TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
