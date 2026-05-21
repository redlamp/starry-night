"use client";

import { useMemo } from "react";
import { generateCity } from "@/lib/seed/cityGen";
import { Building } from "./Building";

export function City({ masterSeed }: { masterSeed: string }) {
  const buildings = useMemo(() => generateCity(masterSeed), [masterSeed]);

  return (
    <group>
      {buildings.map((b) => (
        <Building key={b.id} data={b} masterSeed={masterSeed} />
      ))}
    </group>
  );
}
