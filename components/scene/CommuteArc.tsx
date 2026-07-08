"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { buildPersonaDirectory, type CommuteMode } from "@/lib/seed/personas";

// Personas: when the selected persona has a workplace, arc a line from their
// home roof to their work roof — drawn X-RAY (depthTest off) like the #87
// selection outline, so the pair of buildings reads at any camera angle.
// Colour encodes the commute mode (legend repeated in PersonaPanel's Commute
// row). A tube, not a Line: 1px hairlines vanish at city scale on Windows.

export const COMMUTE_COLORS: Record<CommuteMode, string> = {
  walk: "#3fa87e", // teal — the district-legend green family
  cycle: "#a3d977",
  transit: "#6fa8ff",
  drive: "#e8b04a", // sodium amber, same family as the window light
  bus: "#f5d90a", // school-bus yellow — kids' rides only
};

export function CommuteArc({ masterSeed }: { masterSeed: string }) {
  const selectedPersonaId = useSceneStore((s) => s.selectedPersonaId);
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  // The arcs follow the TOP entity column: persona cards show their commute +
  // connections; building/company cards show where the workforce comes from
  // (user 2026-07-08) — one thin arc per employee, workplace -> home.
  const topRef = columnCursor >= 0 ? columnPath[columnCursor] : undefined;
  const topKey = topRef ? `${topRef.kind}:${topRef.id}` : null;

  const group = useMemo(() => {
    void citySize;
    void citySketch;
    void topKey;
    if (!selectedPersonaId && !topRef) return null;
    const directory = buildPersonaDirectory(masterSeed, cityShape, cityShapeScale);
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    const buildingById = new Map(buildings.map((b) => [b.id, b]));

    const g = new THREE.Group();

    const addArc = (
      from: { x: number; height: number; z: number },
      to: { x: number; height: number; z: number },
      color: THREE.Color,
      radius: number,
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
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius, 6, false), mat);
      tube.renderOrder = 1003; // above the selection outline (1002)
      tube.frustumCulled = false;
      g.add(tube);
      if (withBeads) {
        const beadGeo = new THREE.SphereGeometry(radius * 2.2, 12, 8);
        for (const p of [a, d]) {
          const bead = new THREE.Mesh(beadGeo.clone(), mat);
          bead.position.copy(p);
          bead.renderOrder = 1003;
          bead.frustumCulled = false;
          g.add(bead);
        }
        beadGeo.dispose();
      }
    };

    // Employment arcs for a topmost building/company card: thin violet arcs
    // from the workplace out to every employee's home.
    const employmentColor = new THREE.Color("#9b6bc9");
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
            addArc(site, home, employmentColor, 0.9, 0.5, false);
          }
        }
      }
    };
    if (topRef?.kind === "company") {
      employmentArcs([topRef.id]);
      return g.children.length > 0 ? g : null;
    }
    if (topRef?.kind === "building") {
      employmentArcs((directory.byWorkBuilding.get(topRef.id) ?? []).map((b) => b.id));
      return g.children.length > 0 ? g : null;
    }

    // Persona arcs (the selected persona, synced from the top persona column).
    if (!selectedPersonaId) return null;
    const persona = directory.personas.get(selectedPersonaId);
    if (!persona) return null;
    const home = buildingById.get(persona.homeBuildingId);
    if (!home) return null;

    // The commute arc (thick, mode-coloured): workplace for the employed,
    // school for kids — commuteTargetBuildingId covers both.
    if (persona.commute && persona.commuteTargetBuildingId !== undefined) {
      const work = buildingById.get(persona.commuteTargetBuildingId);
      if (work) {
        addArc(
          home,
          work,
          new THREE.Color(COMMUTE_COLORS[persona.commute.mode]),
          Math.max(1.4, Math.min(4, persona.commute.distance * 0.0035)),
          0.8,
          true,
        );
      }
    }

    // Connection arcs (thin, muted violet): the people this persona is tied
    // to — partner, family, and the one-sided relation target — drawn to
    // their HOMES, so the social graph reads on the skyline.
    const connectionColor = new THREE.Color("#9b6bc9");
    const targets = new Set<string>();
    const connect = (pid: string | undefined) => {
      if (!pid || pid === persona.id || targets.has(pid)) return;
      targets.add(pid);
      const other = directory.personas.get(pid);
      if (!other || other.homeBuildingId === persona.homeBuildingId) return;
      const theirHome = buildingById.get(other.homeBuildingId);
      if (!theirHome) return;
      addArc(home, theirHome, connectionColor, 0.9, 0.55, false);
    };
    connect(persona.partnerId);
    for (const link of persona.family) connect(link.personaId);
    connect(persona.story.relation?.targetId);

    return g.children.length > 0 ? g : null;
    // topRef's identity changes every store update; topKey is its stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonaId, topKey, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!group) return;
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    };
  }, [group]);

  if (!group) return null;
  return <primitive object={group} />;
}
