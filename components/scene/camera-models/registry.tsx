import type { ComponentType } from "react";
import type { CameraModelId } from "@/lib/state/sceneStore";
import { DreiSceneControls } from "../DreiSceneControls";
import { DriftModel } from "./DriftModel";
import { TurntableModel } from "./TurntableModel";
import { TopDownModel } from "./TopDownModel";
import { FlyModel } from "./FlyModel";
import { GoogleEarthModel } from "./GoogleEarthModel";
import { DreiMapControlsModel } from "./DreiMapControlsModel";
import { DreiCameraControlsModel } from "./DreiCameraControlsModel";

// id → controller component. The "map" model IS the existing DreiSceneControls,
// registered WITHOUT modification (the in-flight controller is untouched). New
// "3 Cs" models live in their own files in this folder and are wired here.
//
// Typed as Record<CameraModelId, …> on purpose: adding an id to the union in the
// store without wiring a component here becomes a compile error, so the
// store / catalog / registry can't silently drift apart.
export const CAMERA_MODEL_COMPONENTS: Record<CameraModelId, ComponentType> = {
  map: DreiSceneControls,
  drift: DriftModel,
  turntable: TurntableModel,
  topdown: TopDownModel,
  fly: FlyModel,
  googleearth: GoogleEarthModel,
  dreimap: DreiMapControlsModel,
  dreicamera: DreiCameraControlsModel,
};
