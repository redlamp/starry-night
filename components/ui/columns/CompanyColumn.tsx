"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, ShowMore } from "./EntityColumns";

const STUDENT_CAP = 10;

export function CompanyColumn({ id }: { id: string }) {
  const push = useSceneStore((s) => s.pushColumn);
  const indexes = useEntityIndexes();
  const [allStudents, setAllStudents] = useState(false);
  const biz = indexes.directory.businesses.get(id);
  if (!biz) return <div className="text-sm text-muted-foreground">Company not found.</div>;

  const address = indexes.names.addresses.get(biz.buildingId);
  const buildingName = indexes.names.buildingNames.get(biz.buildingId);
  const students = biz.studentIds ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="capitalize">
          {biz.schoolTier ? `${biz.schoolTier} school` : biz.kind}
        </Badge>
      </div>

      <button
        type="button"
        onClick={() => push({ kind: "building", id: biz.buildingId })}
        className="text-left text-sm text-muted-foreground hover:underline"
      >
        {buildingName ? `${buildingName} · ` : ""}
        {address ? `${address.number} ${address.street}` : `Building #${biz.buildingId}`}
      </button>

      <div className="flex flex-col gap-1">
        <ColumnStat label="Staff" value={biz.employeeIds.length.toLocaleString()} />
        {biz.schoolTier && <ColumnStat label="Students" value={students.length.toLocaleString()} />}
      </div>

      {biz.employeeIds.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">{biz.schoolTier ? "Staff" : "Employees"}</div>
            {biz.employeeIds.map((pid) => {
              const persona = indexes.directory.personas.get(pid);
              if (!persona) return null;
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => push({ kind: "persona", id: pid })}
                  className="-mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
                >
                  <span className="truncate">{persona.fullName}</span>
                  <span className="max-w-[9rem] shrink-0 truncate text-right text-muted-foreground">
                    {persona.profession?.title ?? persona.workStatus}
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
            <div className="text-sm font-medium">Students</div>
            {(allStudents ? students : students.slice(0, STUDENT_CAP)).map((pid) => {
              const persona = indexes.directory.personas.get(pid);
              if (!persona) return null;
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => push({ kind: "persona", id: pid })}
                  className="-mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
                >
                  <span className="truncate">
                    {persona.givenName} {persona.familyName}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{persona.age}</span>
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
