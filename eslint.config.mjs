import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Flat config for ESLint 9+/Next 16. eslint-config-next ships flat-config
// arrays now, so we spread them directly — the old FlatCompat string-extends
// path throws a circular-structure error under ESLint 10.
const eslintConfig = [
  { ignores: ["**/.next/**", "**/out/**", "**/node_modules/**", "**/.remember/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    // React Compiler rules (eslint-plugin-react-hooks v7, enabled by
    // eslint-config-next 16). They only apply when the React Compiler is adopted
    // — this project hasn't — and false-positive on R3F's imperative three.js
    // mutation (mutating camera/objects in effects is the R3F model, not a bug).
    // Off until/unless we turn the compiler on. The classic hooks rules
    // (rules-of-hooks, exhaustive-deps, set-state-in-effect) stay on.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
];

export default eslintConfig;
