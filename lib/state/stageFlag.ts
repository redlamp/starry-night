"use client";

import { useEffect, useState } from "react";

// Reads `?stage1=1` from the URL once on client mount.
// Used to gate streets-first city-planning features (highways, district shells,
// new panels) behind a flag until PR 5 ships and the flag is retired.
export function useStage1Flag(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setEnabled(params.get("stage1") === "1");
  }, []);
  return enabled;
}
