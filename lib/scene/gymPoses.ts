// moire-gym poses — the canonical camera setups that reproduce the window
// aliasing artifact families (#82), shared by the headless runner
// (scripts/moireGym.ts) and the `?cam=<name>` view-link parameter (a named
// pose is accepted anywhere a comma-encoded view is — lib/scene/viewLink).
// One source of truth: a scenario added here is immediately scoreable headless
// AND viewable in a browser.
//
// Live viewing: http://localhost:7827/?cam=band-close&seed=starry-night
// parks the camera at the pose in Still mode with the normal UI available —
// tweak sliders and watch; pick a camera model in the panel to fly away from it.

export interface GymPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  /** what the pose is meant to show — printed alongside the headless score */
  expects: string;
}

export const GYM_SEED = "starry-night"; // the seed the 2026-07-02 recordings ran

export const GYM_POSES: Record<string, GymPose> = {
  telephoto: {
    // The round-2 user pose (Copy Settings, 2026-07-02): ~2.77km out, fov 24.6.
    position: [-108.66, 160.1, -2801],
    lookAt: [-27, 211, -38],
    fov: 24.6,
    expects: "isotropic sub-pixel speckle on distant facades",
  },
  "street-graze": {
    // Among the mid-rises looking through to downtown (video-2 regime): near
    // faces resolved and clean, mid-field faces angled away — X sub-resolved
    // while Y stays resolved (vertical stripe combs / grazing churn).
    position: [120, 70, 350],
    lookAt: [-40, 110, -900],
    fov: 55,
    expects: "grazing churn on angled faces; bottom third stays clean",
  },
  "band-close": {
    // Elevated mid-range toward downtown (video-1 regime): band/curtain
    // floors at a few px per pane.
    position: [700, 260, 1500],
    lookAt: [-100, 180, -100],
    fov: 40,
    expects: "stripe/beat inside band and curtain floors",
  },
  "near-guard": {
    // Regression guard: frame-filling near building (huge crisp windows) with
    // downtown behind. The BOTTOM third must stay low and visually crisp — a
    // fix that washes it flat is a fail; the top third should improve.
    position: [40, 80, 150],
    lookAt: [-60, 95, -30],
    fov: 45,
    expects: "bottom third clean/crisp (guard); top third = artifact to fix",
  },
};
