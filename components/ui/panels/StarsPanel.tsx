"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RangeSlider, ValueSlider } from "@/components/ui/value-slider";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";

export function StarsSection() {
  const stars = useSceneStore((s) => s.stars);
  const setStars = useSceneStore((s) => s.setStars);
  return (
    <>
      <ValueSlider
        label="size"
        value={stars.factor}
        min={0.5}
        max={60}
        step={0.5}
        onChange={(factor) => setStars({ factor })}
      />
      <ValueSlider
        label="radius"
        value={stars.radius}
        min={500}
        max={30000}
        step={100}
        onChange={(radius) => setStars({ radius })}
      />
      <ValueSlider
        label="depth"
        value={stars.depth}
        min={50}
        max={8000}
        step={50}
        onChange={(depth) => setStars({ depth })}
      />
      <ValueSlider
        label="count"
        value={stars.count}
        min={100}
        max={30000}
        step={100}
        onChange={(count) => setStars({ count })}
      />
      {/* Twinkle amplitude (σ of the log-normal scintillation). 0 = steady; the shader
          scales it by (sec z)^1.5 so horizon stars twinkle harder than the zenith. */}
      <ValueSlider
        label="twinkle"
        value={stars.twinkle}
        min={0}
        max={3}
        step={0.05}
        onChange={(twinkle) => setStars({ twinkle })}
      />
      {/* Per-star noise timescale range, ms. Lower = faster flicker; the shader adds
          faster octaves on top, so visible flicker is brisker than these numbers. */}
      <RangeSlider
        label="rate ms"
        value={[stars.twinkleMinMs, stars.twinkleMaxMs]}
        min={100}
        max={6000}
        step={50}
        onChange={([twinkleMinMs, twinkleMaxMs]) => setStars({ twinkleMinMs, twinkleMaxMs })}
      />
      {/* Chromatic flash: red/green/blue shimmer, auto-gated to low + bright stars. */}
      <ValueSlider
        label="chroma"
        value={stars.twinkleChroma}
        min={0}
        max={1}
        step={0.05}
        onChange={(twinkleChroma) => setStars({ twinkleChroma })}
      />
      {/* #26 meteors: toggle + min/max seconds between streaks. Each fired
          streak rolls the next gap uniformly inside this range. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">meteors</span>
        <Switch
          checked={stars.meteorsEnabled}
          onCheckedChange={(meteorsEnabled) => setStars({ meteorsEnabled })}
          aria-label="Enable meteors"
        />
        <Slider
          min={0.01}
          max={180}
          step={0.01}
          value={[stars.shootingMin, stars.shootingMax]}
          onValueChange={(v) => {
            const [shootingMin, shootingMax] = v as number[];
            setStars({ shootingMin, shootingMax });
          }}
          className="flex-1"
        />
        <NumberField
          value={stars.shootingMin}
          min={0.01}
          max={stars.shootingMax}
          step={1}
          onValueChange={(v) => {
            if (v !== null) setStars({ shootingMin: Math.min(v, stars.shootingMax) });
          }}
        >
          <NumberFieldGroup className="bg-background/60 h-7 w-13 shrink-0">
            <NumberFieldInput className="text-xs" aria-label="Min seconds between meteors" />
          </NumberFieldGroup>
        </NumberField>
        <NumberField
          value={stars.shootingMax}
          min={stars.shootingMin}
          max={180}
          step={1}
          onValueChange={(v) => {
            if (v !== null) setStars({ shootingMax: Math.max(v, stars.shootingMin) });
          }}
        >
          <NumberFieldGroup className="bg-background/60 h-7 w-13 shrink-0">
            <NumberFieldInput className="text-xs" aria-label="Max seconds between meteors" />
          </NumberFieldGroup>
        </NumberField>
      </div>
    </>
  );
}
