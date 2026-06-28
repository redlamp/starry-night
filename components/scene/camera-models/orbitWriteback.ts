import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

// Shared per-frame pose write-back for the vanilla drei orbit models (Drei - MapControls
// / Drei - CameraControls). Mirrors the custom models' ~10/s sync so the camera-anchored
// fog, moon-follow, projection readout, and the panel's compass/elevation/distance track
// the live pose. Orbit angles are DERIVED from the camera→target offset using the same
// convention the custom models drive forward with (az = atan2(x, z), elevation = asin(y/R)),
// so switching back to Map seeds continuously from where the vanilla control left off.

const RAD2DEG = 180 / Math.PI;
const _off = new THREE.Vector3();
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function writeOrbitPose(cam: THREE.PerspectiveCamera, target: THREE.Vector3) {
  const s = useSceneStore.getState();
  s.setCameraLive({
    position: [cam.position.x, cam.position.y, cam.position.z],
    rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
    fov: cam.fov,
  });
  _off.copy(cam.position).sub(target);
  const R = _off.length();
  const elev = R > 1e-3 ? Math.asin(clamp(_off.y / R, -1, 1)) * RAD2DEG : 0;
  const az = Math.atan2(_off.x, _off.z) * RAD2DEG;
  s.setOrbit({
    azimuthDeg: round1(((az % 360) + 360) % 360),
    elevationDeg: round1(elev),
    radius: Math.round(R),
    centerX: Math.round(target.x),
    centerZ: Math.round(target.z),
    lookAtY: Math.round(target.y),
  });
}
