"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { seededRng } from "@/lib/seed/rng";
import type { CommuteMode, Persona } from "@/lib/seed/personas";
import { ensureBuildingStories } from "@/lib/seed/personaStory";
import { tenancyLayout, regionForHousehold, regionForBusiness, type TenantRegion } from "@/lib/seed/tenancyLayout";

// Relationship arcs over the city, X-RAY drawn (depthTest off) like the #87
// selection outline. Line2 with SCREEN-SPACE widths (pixel widths stay readable
// at any distance). The arcs follow the TOP entity column: persona cards show
// their commute (thick, mode-coloured) + connections (thin violet to partner/
// family/relation homes); building/company cards show the workforce — one thin
// arc per employee, workplace -> home. Each person's endpoint is the TOP CENTRE
// of their home UNIT cube (user 2026-07-12), so lines spring from the unit, not
// the building roof.

export const COMMUTE_COLORS: Record<CommuteMode, string> = {
  walk: "#3fa87e", // teal — the district-legend green family
  cycle: "#a3d977",
  transit: "#6fa8ff",
  drive: "#e8b04a", // sodium amber, same family as the window light
  bus: "#f5d90a", // school-bus yellow — kids' rides only
};

const ARC_SAMPLES = 48;
// Exported: the resident/company cards colour their Family/Employees headers
// with the same violet the connection/employment arcs use — card and skyline
// share one legend.
export const CONNECTION_COLOR = "#9b6bc9";

const UP = new THREE.Vector3(0, 1, 0);

export function CommuteArc({ masterSeed }: { masterSeed: string }) {
  const selectedPersonaId = useSceneStore((s) => s.selectedPersonaId);
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const topRef = columnCursor >= 0 ? columnPath[columnCursor] : undefined;
  const topKey = topRef ? `${topRef.kind}:${topRef.id}` : null;

  const directory = usePersonaDirectoryDeferred(Boolean(selectedPersonaId || topRef));

  const materialsRef = useRef<LineMaterial[]>([]);
  useFrame(({ size }) => {
    for (const mat of materialsRef.current) mat.resolution.set(size.width, size.height);
  });

  const built = useMemo(() => {
    void citySize;
    void citySketch;
    void topKey;
    const materials: LineMaterial[] = [];
    if (!selectedPersonaId && !topRef) return null;
    if (!directory) return null;
    const dir = directory;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const districtById = new Map(districts.map((d) => [d.id, d]));

    const g = new THREE.Group();

    // tenancy regions per building, cached (several personas can share a building)
    const layoutCache = new Map<number, TenantRegion[]>();
    const regionsFor = (b: Building): TenantRegion[] => {
      let r = layoutCache.get(b.id);
      if (!r) {
        const character = districtById.get(b.districtId)?.character ?? "residential";
        r = tenancyLayout(
          b,
          dir.byHomeBuilding.get(b.id) ?? [],
          dir.byWorkBuilding.get(b.id) ?? [],
          character,
          seededRng(`${masterSeed}::personas::tenancy::${b.id}`),
        );
        layoutCache.set(b.id, r);
      }
      return r;
    };

    const buildingTop = (b: Building) => new THREE.Vector3(b.x, b.height + 4, b.z);

    // Top centre of a unit cube, in world space (local unit-box → scale → rotate → translate).
    const unitTop = (b: Building, region: TenantRegion) => {
      const cx = (region.xMin + region.xMax) / 2;
      const cz = (region.zMin + region.zMax) / 2;
      const yTop = region.floorEnd / b.floors - 0.5;
      const v = new THREE.Vector3(cx * b.width, yTop * b.height, cz * b.depth);
      v.applyAxisAngle(UP, -b.rotationY);
      v.add(new THREE.Vector3(b.x, b.height / 2, b.z));
      v.y += 4; // small clearance above the cube top
      return v;
    };

    // A person's anchor: the top centre of their home unit, or the building top
    // if their household isn't a featured unit.
    const personaAnchor = (p: Persona): THREE.Vector3 | null => {
      const home = buildingById.get(p.homeBuildingId);
      if (!home) return null;
      const region =
        p.householdIndex !== undefined ? regionForHousehold(regionsFor(home), p.householdIndex) : undefined;
      return region ? unitTop(home, region) : buildingTop(home);
    };

    // A business's anchor: the top centre of its unit (a whole-floor slab or a
    // storefront), or the building top if it isn't a featured unit.
    const businessAnchor = (b: Building, businessId?: string): THREE.Vector3 => {
      const region = businessId ? regionForBusiness(regionsFor(b), businessId) : undefined;
      return region ? unitTop(b, region) : buildingTop(b);
    };

    const addArc = (a: THREE.Vector3, d: THREE.Vector3, color: string, widthPx: number, opacity: number) => {
      const dist = Math.hypot(d.x - a.x, d.z - a.z);
      const apex = Math.max(a.y, d.y) + Math.min(420, 40 + dist * 0.22);
      const bb = a.clone().lerp(d, 0.3).setY(apex);
      const cc = a.clone().lerp(d, 0.7).setY(apex);
      const curve = new THREE.CubicBezierCurve3(a, bb, cc, d);
      const positions: number[] = [];
      for (let i = 0; i <= ARC_SAMPLES; i++) {
        const p = curve.getPoint(i / ARC_SAMPLES);
        positions.push(p.x, p.y, p.z);
      }
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: widthPx,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
      material.toneMapped = false;
      materials.push(material);
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 1003; // above the selection outline (1002)
      line.frustumCulled = false;
      g.add(line);
    };

    // Employment arcs for a topmost building/company card: workplace -> each home.
    const employmentArcs = (bizIds: string[]) => {
      for (const bizId of bizIds) {
        const biz = dir.businesses.get(bizId);
        if (!biz) continue;
        const site = buildingById.get(biz.buildingId);
        if (!site) continue;
        const siteAnchor = businessAnchor(site, biz.id);
        for (const pid of biz.employeeIds) {
          const worker = dir.personas.get(pid);
          if (!worker || worker.homeBuildingId === site.id) continue;
          const anchor = personaAnchor(worker);
          if (anchor) addArc(siteAnchor, anchor, CONNECTION_COLOR, 1.5, 0.55);
        }
      }
    };

    const done = () => (g.children.length > 0 ? { group: g, materials } : null);
    if (topRef?.kind === "company") {
      employmentArcs([topRef.id]);
      return done();
    }
    if (topRef?.kind === "building") {
      employmentArcs((dir.byWorkBuilding.get(topRef.id) ?? []).map((b) => b.id));
      return done();
    }

    // Persona arcs (the selected persona, synced from the top persona column).
    if (!selectedPersonaId) return null;
    const persona = dir.personas.get(selectedPersonaId);
    if (!persona) return null;
    const homeAnchor = personaAnchor(persona);
    if (!homeAnchor) return null;

    // The commute arc: workplace for the employed, school for kids.
    if (persona.commute && persona.commuteTargetBuildingId !== undefined) {
      const work = buildingById.get(persona.commuteTargetBuildingId);
      if (work) {
        addArc(
          homeAnchor,
          businessAnchor(work, persona.businessId ?? persona.schoolId),
          COMMUTE_COLORS[persona.commute.mode],
          3.5,
          0.85,
        );
      }
    }

    // Connection arcs: partner, family, and the one-sided relation target, drawn
    // to their unit cubes — the social graph on the skyline.
    const targets = new Set<string>();
    const connect = (pid: string | undefined) => {
      if (!pid || pid === persona.id || targets.has(pid)) return;
      targets.add(pid);
      const other = dir.personas.get(pid);
      if (!other) return;
      // Skip only if they share the exact same unit (same building + household).
      if (other.homeBuildingId === persona.homeBuildingId && other.householdIndex === persona.householdIndex) return;
      const anchor = personaAnchor(other);
      if (anchor) addArc(homeAnchor, anchor, CONNECTION_COLOR, 1.75, 0.6);
    };
    connect(persona.partnerId);
    for (const link of persona.family) connect(link.personaId);
    // The relation edge is lazy-tier — materialize this persona's building first.
    ensureBuildingStories(masterSeed, dir, persona.homeBuildingId);
    connect(persona.story.relation?.targetId);

    return done();
    // topRef's identity changes every store update; topKey is its stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonaId, topKey, directory, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    materialsRef.current = built?.materials ?? [];
    return () => {
      materialsRef.current = [];
      if (!built) return;
      built.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof Line2) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    };
  }, [built]);

  if (!built) return null;
  return <primitive object={built.group} />;
}
