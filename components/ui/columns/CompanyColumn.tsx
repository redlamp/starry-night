"use client";

import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CONNECTION_COLOR } from "@/components/scene/CommuteArc";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, ShowMore } from "./EntityColumns";
import { WorkplaceKindBadge } from "./workplaceIcons";

const STUDENT_CAP = 10;

export function CompanyColumn({ id, part }: { id: string; part: "pinned" | "rest" }) {
  const push = useSceneStore((s) => s.pushColumn);
  const indexes = useEntityIndexes();
  const [allStudents, setAllStudents] = useState(false);
  const biz = indexes.directory.businesses.get(id);
  if (!biz) {
    return part === "pinned" ? null : (
      <div className="text-muted-foreground text-sm">Company not found.</div>
    );
  }

  const address = indexes.names.addresses.get(biz.buildingId);
  const buildingName = indexes.names.buildingNames.get(biz.buildingId);
  const students = biz.studentIds ?? [];

  if (part === "pinned") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkplaceKindBadge
            kind={biz.kind}
            label={biz.schoolTier ? `${biz.schoolTier} school` : biz.kind}
          />
        </div>

        <button
          type="button"
          onClick={() => push({ kind: "building", id: biz.buildingId })}
          className="text-muted-foreground text-left text-sm hover:underline"
        >
          {buildingName ? `${buildingName} · ` : ""}
          {address ? `${address.number} ${address.street}` : `Building #${biz.buildingId}`}
        </button>

        <div className="flex flex-col gap-1">
          <ColumnStat
            label="Staff"
            value={`${biz.employeeIds.length.toLocaleString()} listed of ${biz.totalHeadcount.toLocaleString()}`}
          />
          {biz.schoolTier && (
            <ColumnStat label="Students" value={students.length.toLocaleString()} />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {biz.employeeIds.length > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium" style={{ color: CONNECTION_COLOR }}>
              {biz.schoolTier ? "Staff" : "Employees"}
            </div>
            {biz.employeeIds.map((pid) => {
              const persona = indexes.directory.personas.get(pid);
              if (!persona) return null;
              const title = persona.profession?.title ?? persona.workStatus;
              // Long name+title pairs stack to two lines instead of
              // truncating against each other (user 2026-07-08).
              if (persona.fullName.length + title.length > 32) {
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => push({ kind: "persona", id: pid })}
                    className="hover:bg-foreground/10 -mx-1 flex flex-col rounded px-1 text-left text-sm"
                  >
                    <span className="truncate">{persona.fullName}</span>
                    <span className="text-muted-foreground truncate text-right text-xs">
                      {title}
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => push({ kind: "persona", id: pid })}
                  className="hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm"
                >
                  <span className="truncate">{persona.fullName}</span>
                  <span className="text-muted-foreground max-w-[9rem] shrink-0 truncate text-right">
                    {title}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {students.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium">Students</div>
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">Age</span>
            </div>
            {(allStudents ? students : students.slice(0, STUDENT_CAP)).map((pid) => {
              const persona = indexes.directory.personas.get(pid);
              if (!persona) return null;
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => push({ kind: "persona", id: pid })}
                  className="hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm"
                >
                  <span className="truncate">
                    {persona.givenName} {persona.familyName}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">{persona.age}</span>
                </button>
              );
            })}
            <ShowMore
              total={students.length}
              cap={STUDENT_CAP}
              expanded={allStudents}
              onToggle={() => setAllStudents(!allStudents)}
              noun="students"
            />
          </div>
        </>
      )}
    </>
  );
}
