"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity } from "@/lib/seed/cityGen";
import type { CommuteMode } from "@/lib/seed/personas";
import { ensureBuildingStories } from "@/lib/seed/personaStory";

// Relationship arcs over the city, X-RAY drawn (depthTest off) like the #87
// selection outline. Line2 with SCREEN-SPACE widths (user 2026-07-08: tubes
// in world units vanished when zoomed out; pixel widths stay readable at any
// distance). The arcs follow the TOP entity column: persona cards show their
// commute (thick, mode-coloured) + connections (thin violet to partner/
// family/relation homes); building/company cards show the workforce — one
// thin arc per employee, workplace -> home.

export const COMMUTE_COLORS: Record<CommuteMode, string> = {
  walk: "#3fa87e", // teal — the district-legend green family
  cycle: "#a3d977",
  transit: "#6fa8ff",
  drive: "#e8b04a", // sodium amber, same family as the window light
  bus: "#f5d90a", // school-bus yellow — kids' rides only
};

const ARC_SAMPLES = 48;
// Exported: the resident/company cards colour their Family/Employees
// headers with the same violet the connection/employment arcs use
// (user 2026-07-10) — card and skyline share one legend.
export const CONNECTION_COLOR = "#9b6bc9";

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

  // Stage A perf fix: only pay/wait for the persona directory's cold build
  // when there's actually something to draw arcs for. Null while the build
  // is pending — arcs pop in a beat after it lands, which is fine (this is a
  // decorative overlay, not a gate on anything else).
  const directory = usePersonaDirectoryDeferred(Boolean(selectedPersonaId || topRef));

  // Line2 materials need the live viewport size for pixel-width rendering.
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
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    const buildingById = new Map(buildings.map((b) => [b.id, b]));

    const g = new THREE.Group();

    const addArc = (
      from: { x: number; height: number; z: number },
      to: { x: number; height: number; z: number },
      color: string,
      widthPx: number,
      opacity: number,
      withBeads: boolean,
    ) => {
      const a = new THREE.Vector3(from.x, from.height + 4, from.z);
      const d = new THREE.Vector3(to.x, to.height + 4, to.z);
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      // Apex clears the taller endpoint and scales with the span, so a
      // cross-town arc reads ballistic and a hop to the corner stays low.
      const apex = Math.max(from.height, to.height) + Math.min(420, 40 + dist * 0.22);
      const b = a.clone().lerp(d, 0.3).setY(apex);
      const c = a.clone().lerp(d, 0.7).setY(apex);
      const curve = new THREE.CubicBezierCurve3(a, b, c, d);

      const positions: number[] = [];
      for (let i = 0; i <= ARC_SAMPLES; i++) {
        const p = curve.getPoint(i / ARC_SAMPLES);
        positions.push(p.x, p.y, p.z);
      }
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: widthPx, // px — worldUnits stays false
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

      if (withBeads) {
        const beadMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
          fog: false,
          toneMapped: false,
        });
        const beadGeo = new THREE.SphereGeometry(Math.max(3, dist * 0.006), 12, 8);
        for (const p of [a, d]) {
          const bead = new THREE.Mesh(beadGeo.clone(), beadMat);
          bead.position.copy(p);
          bead.renderOrder = 1003;
          bead.frustumCulled = false;
          g.add(bead);
        }
        beadGeo.dispose();
      }
    };

    // Employment arcs for a topmost building/company card.
    const employmentArcs = (bizIds: string[]) => {
      for (const bizId of bizIds) {
        const biz = directory.businesses.get(bizId);
        if (!biz) continue;
        const site = buildingById.get(biz.buildingId);
        if (!site) continue;
        for (const pid of biz.employeeIds) {
          const worker = directory.personas.get(pid);
          const home = worker ? buildingById.get(worker.homeBuildingId) : undefined;
          if (home && home.id !== site.id) {
            addArc(site, home, CONNECTION_COLOR, 1.5, 0.55, false);
          }
        }
      }
    };
    const done = () => (g.children.length > 0 ? { group: g, materials } : null);
    if (topRef?.kind === "company") {
      employmentArcs([topRef.id]);
      return done();
    }
    if (topRef?.kind === "building") {
      employmentArcs((directory.byWorkBuilding.get(topRef.id) ?? []).map((b) => b.id));
      return done();
    }

    // Persona arcs (the selected persona, synced from the top persona column).
    if (!selectedPersonaId) return null;
    const persona = directory.personas.get(selectedPersonaId);
    if (!persona) return null;
    const home = buildingById.get(persona.homeBuildingId);
    if (!home) return null;

    // The commute arc: workplace for the employed, school for kids.
    if (persona.commute && persona.commuteTargetBuildingId !== undefined) {
      const work = buildingById.get(persona.commuteTargetBuildingId);
      if (work) {
        addArc(home, work, COMMUTE_COLORS[persona.commute.mode], 3.5, 0.85, true);
      }
    }

    // Connection arcs: partner, family, and the one-sided relation target,
    // drawn to their HOMES — the social graph on the skyline.
    const targets = new Set<string>();
    const connect = (pid: string | undefined) => {
      if (!pid || pid === persona.id || targets.has(pid)) return;
      targets.add(pid);
      const other = directory.personas.get(pid);
      if (!other || other.homeBuildingId === persona.homeBuildingId) return;
      const theirHome = buildingById.get(other.homeBuildingId);
      if (!theirHome) return;
      addArc(home, theirHome, CONNECTION_COLOR, 1.75, 0.6, false);
    };
    connect(persona.partnerId);
    for (const link of persona.family) connect(link.personaId);
    // The relation edge is lazy-tier — materialize this persona's building
    // before reading it (idempotent, sub-ms for one building).
    ensureBuildingStories(masterSeed, directory, persona.homeBuildingId);
    connect(persona.story.relation?.targetId);

    return done();
    // topRef's identity changes every store update; topKey is its stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPersonaId,
    topKey,
    directory,
    masterSeed,
    cityShape,
    cityShapeScale,
    citySize,
    citySketch,
  ]);

  // Publish the memo's materials to the frame-loop ref OUTSIDE render.
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
