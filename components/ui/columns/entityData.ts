"use client";

import { useMemo } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import type { District } from "@/lib/seed/district";
import {
  buildPersonaDirectory,
  type PersonaDirectory,
  type Persona,
  type Business,
  type Household,
} from "@/lib/seed/personas";
import { residentialCapacity } from "@/lib/seed/population";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { CityNames } from "@/lib/seed/naming";

// Shared data spine for the entity columns (Miller-columns drill). One
// memoised bundle of cross-indexes — street ↔ buildings ↔ companies ↔ people,
// district aggregates — derived entirely from the module-cached generators,
// so every column resolves its EntityRef against the same warm objects.
// Determinism contract: everything here is derived; nothing is stored.

export type RoadInfo = {
  roadId: string;
  name: string;
  tier: "highway" | "arterial" | "minor";
  vertices: Array<{ x: number; z: number }>;
};

export type DistrictAgg = {
  district: District;
  properName: string;
  residentCount: number; // listed residents — the browsable sample
  populationEst: number; // full residential capacity (#96)
  companyCount: number;
  // Streets serving this district's addressed buildings, busiest first.
  streets: Array<{ roadId: string; name: string; buildingCount: number }>;
  // The named landmarks ("The Meridian") in this district.
  namedBuildings: Array<{ buildingId: number; name: string }>;
  homeBuildingCount: number;
};

export type StreetAgg = {
  road: RoadInfo;
  buildingIds: number[]; // in address order (a walk down the street)
  companies: Business[];
  residentCount: number; // listed residents — the browsable sample
  populationEst: number; // full residential capacity (#96)
  residentsSample: Persona[]; // capped — columns show "N residents · sample"
  districts: District[]; // districts the street's buildings sit in
};

export type EntityIndexes = {
  directory: PersonaDirectory;
  names: CityNames;
  buildingById: Map<number, Building>;
  districtById: Map<string, District>;
  roadById: Map<string, RoadInfo>;
  districtAgg: (districtId: string) => DistrictAgg | null;
  streetAgg: (roadId: string) => StreetAgg | null;
  companiesInBuilding: (buildingId: number) => Business[];
  householdsInBuilding: (buildingId: number) => Household[];
};

const RESIDENT_SAMPLE_CAP = 30;

// The shared bundle-build, extracted so both the sync (useEntityIndexes) and
// deferred (useEntityIndexesDeferred) hooks run the exact same derivation —
// the only difference is WHEN buildPersonaDirectory's cold cost lands.
function buildEntityIndexes(
  masterSeed: string,
  cityShape: CityShapeSetting,
  cityShapeScale: number,
): EntityIndexes {
  const directory = buildPersonaDirectory(masterSeed, cityShape, cityShapeScale);
  const names = directory.names;
  const city = generateCity(masterSeed, cityShape, cityShapeScale);
  const buildingById = new Map<number, Building>(city.buildings.map((b) => [b.id, b]));
  const districtById = new Map<string, District>(city.districts.map((d) => [d.id, d]));

  const roadById = new Map<string, RoadInfo>();
  const addRoads = (
    roads: Array<{ id: string; vertices: Array<{ x: number; z: number }> }>,
    tier: RoadInfo["tier"],
  ) => {
    for (const r of roads) {
      roadById.set(r.id, {
        roadId: r.id,
        name: names.streetNames.get(r.id) ?? "Unnamed Road",
        tier,
        vertices: r.vertices,
      });
    }
  };
  addRoads(city.topology.highways, "highway");
  addRoads(city.arterials, "arterial");
  addRoads(city.streets, "minor");

  // District → streets/companies/residents rollups, one O(N) pass each.
  const streetsByDistrict = new Map<string, Map<string, number>>(); // districtId → roadId → building count
  for (const [buildingId, address] of names.addresses) {
    const b = buildingById.get(buildingId);
    if (!b) continue;
    let roads = streetsByDistrict.get(b.districtId);
    if (!roads) {
      roads = new Map();
      streetsByDistrict.set(b.districtId, roads);
    }
    roads.set(address.roadId, (roads.get(address.roadId) ?? 0) + 1);
  }
  const residentsByDistrict = new Map<string, number>();
  const homeBuildingsByDistrict = new Map<string, number>();
  for (const [buildingId, households] of directory.byHomeBuilding) {
    const b = buildingById.get(buildingId);
    if (!b) continue;
    const heads = households.reduce((sum, hh) => sum + hh.memberIds.length, 0);
    residentsByDistrict.set(b.districtId, (residentsByDistrict.get(b.districtId) ?? 0) + heads);
    homeBuildingsByDistrict.set(
      b.districtId,
      (homeBuildingsByDistrict.get(b.districtId) ?? 0) + 1,
    );
  }
  // Full census capacity per district (#96) — building-derived, one pass,
  // mixed-use towers included (recalibrated 2026-07-18).
  const populationByDistrict = new Map<string, number>();
  for (const b of city.buildings) {
    const capacity = residentialCapacity(b);
    if (capacity === 0) continue;
    populationByDistrict.set(
      b.districtId,
      (populationByDistrict.get(b.districtId) ?? 0) + capacity,
    );
  }
  const companiesByDistrict = new Map<string, number>();
  for (const biz of directory.businesses.values()) {
    const b = buildingById.get(biz.buildingId);
    if (!b) continue;
    companiesByDistrict.set(b.districtId, (companiesByDistrict.get(b.districtId) ?? 0) + 1);
  }
  const namedByDistrict = new Map<string, Array<{ buildingId: number; name: string }>>();
  for (const [buildingId, name] of names.buildingNames) {
    const b = buildingById.get(buildingId);
    if (!b) continue;
    const list = namedByDistrict.get(b.districtId) ?? [];
    list.push({ buildingId, name });
    namedByDistrict.set(b.districtId, list);
  }

  const districtAgg = (districtId: string): DistrictAgg | null => {
    const district = districtById.get(districtId);
    if (!district) return null;
    const streets = [...(streetsByDistrict.get(districtId) ?? new Map<string, number>())]
      .map(([roadId, buildingCount]) => ({
        roadId,
        name: roadById.get(roadId)?.name ?? "Unnamed Road",
        buildingCount,
      }))
      .sort((a, b) => b.buildingCount - a.buildingCount);
    return {
      district,
      properName: names.districtNames.get(districtId) ?? district.displayName,
      residentCount: residentsByDistrict.get(districtId) ?? 0,
      populationEst: Math.round(populationByDistrict.get(districtId) ?? 0),
      companyCount: companiesByDistrict.get(districtId) ?? 0,
      streets,
      namedBuildings: namedByDistrict.get(districtId) ?? [],
      homeBuildingCount: homeBuildingsByDistrict.get(districtId) ?? 0,
    };
  };

  const streetAgg = (roadId: string): StreetAgg | null => {
    const road = roadById.get(roadId);
    if (!road) return null;
    const buildingIds = names.buildingsByRoad.get(roadId) ?? [];
    const companies: Business[] = [];
    const residentsSample: Persona[] = [];
    let residentCount = 0;
    let populationEst = 0;
    const districts = new Map<string, District>();
    for (const buildingId of buildingIds) {
      const b = buildingById.get(buildingId);
      if (b) {
        const d = districtById.get(b.districtId);
        if (d) districts.set(d.id, d);
        populationEst += residentialCapacity(b);
      }
      for (const biz of directory.byWorkBuilding.get(buildingId) ?? []) companies.push(biz);
      for (const hh of directory.byHomeBuilding.get(buildingId) ?? []) {
        residentCount += hh.memberIds.length;
        for (const pid of hh.memberIds) {
          if (residentsSample.length < RESIDENT_SAMPLE_CAP) {
            const p = directory.personas.get(pid);
            if (p) residentsSample.push(p);
          }
        }
      }
    }
    return {
      road,
      buildingIds,
      companies,
      residentCount,
      populationEst: Math.round(populationEst),
      residentsSample,
      districts: [...districts.values()],
    };
  };

  return {
    directory,
    names,
    buildingById,
    districtById,
    roadById,
    districtAgg,
    streetAgg,
    companiesInBuilding: (buildingId: number) => directory.byWorkBuilding.get(buildingId) ?? [],
    householdsInBuilding: (buildingId: number) => directory.byHomeBuilding.get(buildingId) ?? [],
  };
}

export function useEntityIndexes(): EntityIndexes {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // Memo-dep mirror of BuildingInfoPanel's idiom: citySize/citySketch drive
  // module-level gen state the generators' own cache keys account for.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  // #90: naming pack is the same kind of module-level gen-state dependency.
  const namingRegion = useSceneStore((s) => s.namingRegion);

  return useMemo(() => {
    void citySize;
    void citySketch;
    void namingRegion;
    return buildEntityIndexes(masterSeed, cityShape, cityShapeScale);
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch, namingRegion]);
}

// Deferred sibling: shares usePersonaDirectoryDeferred's gate (always
// enabled — every column consumer implies the panel is open), so this stays
// null until the directory's cold build has landed. Once `dir` is non-null
// the build inside buildEntityIndexes is warm (buildPersonaDirectory hits the
// module cache), so the useMemo below stays cheap — it's the district/street
// rollups, not the persona generation, that run synchronously here.
export function useEntityIndexesDeferred(): EntityIndexes | null {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const namingRegion = useSceneStore((s) => s.namingRegion);
  const dir = usePersonaDirectoryDeferred(true);

  return useMemo(() => {
    void citySize;
    void citySketch;
    void namingRegion;
    return dir ? buildEntityIndexes(masterSeed, cityShape, cityShapeScale) : null;
  }, [dir, masterSeed, cityShape, cityShapeScale, citySize, citySketch, namingRegion]);
}
