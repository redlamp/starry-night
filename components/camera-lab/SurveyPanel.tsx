"use client";

// Survey UI for the active method: a 1-5 rating per dimension + free-text notes,
// plus global notes and JSON export (copy / download) so the feedback can be
// imported and reviewed. State lives in useLabFeedback (localStorage-persisted).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { METHODS, type CameraMethod } from "./methods";
import type { LabTuning } from "./tuning";
import { DIMENSIONS, type Feedback } from "./useLabFeedback";

function RatingRow({
  label,
  value,
  onPick,
}: {
  label: string;
  value: number;
  onPick: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            className={`h-5 w-5 rounded text-[10px] tabular-nums transition-colors ${
              value === n
                ? "bg-teal-500 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            title={value === n ? "click again to clear" : `rate ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SurveyPanel({
  method,
  tuning,
  feedback,
  onRate,
  onNotes,
  onGlobalNotes,
}: {
  method: CameraMethod;
  tuning: LabTuning;
  feedback: Feedback;
  onRate: (id: string, dim: string, v: number) => void;
  onNotes: (id: string, text: string) => void;
  onGlobalNotes: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const mine = feedback.byMethod[method.id] ?? { ratings: {}, notes: "" };

  const buildJson = () =>
    JSON.stringify(
      {
        tool: "camera-lab",
        savedAt: new Date().toISOString(),
        activeMethod: method.id,
        tuning,
        methods: METHODS.map((m) => ({ id: m.id, name: m.name, parallel: m.parallel })),
        feedback,
      },
      null,
      2,
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildJson());
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard may be blocked; the download button is the fallback
    }
  };

  const download = () => {
    const blob = new Blob([buildJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "camera-lab-feedback.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] leading-snug text-zinc-500">
        Rate <span className="text-zinc-300">{method.name}</span> after running the test tasks.
        Click a number; click it again to clear.
      </div>
      {DIMENSIONS.map((d) => (
        <RatingRow
          key={d.key}
          label={d.label}
          value={mine.ratings[d.key] ?? 0}
          onPick={(v) => onRate(method.id, d.key, v)}
        />
      ))}
      <textarea
        value={mine.notes}
        onChange={(e) => onNotes(method.id, e.target.value)}
        placeholder={`Notes on ${method.name}… (what felt good / bad, vs other methods)`}
        rows={3}
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-900/80 p-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-teal-600 focus:outline-none"
      />

      <div className="mt-1 text-[11px] text-zinc-500">Overall notes (all methods)</div>
      <textarea
        value={feedback.globalNotes}
        onChange={(e) => onGlobalNotes(e.target.value)}
        placeholder="Cross-cutting thoughts, a ranking, what to ship…"
        rows={3}
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-900/80 p-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-teal-600 focus:outline-none"
      />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? "Copied!" : "Copy JSON"}
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          Download
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-zinc-600">
        Saved in this browser automatically. Copy + paste the JSON to Claude (works on any device),
        or Download it (lands in Downloads, which Claude can read) for review.
      </p>
    </div>
  );
}
