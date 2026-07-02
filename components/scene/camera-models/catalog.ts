// Re-export all catalog symbols from the canonical lib location so existing
// component importers keep working without any import-path changes.
export type { CameraModelMeta } from "@/lib/scene/cameraModelCatalog";
export { CAMERA_MODELS, DEFAULT_CAMERA_MODEL, getCameraModelMeta } from "@/lib/scene/cameraModelCatalog";
