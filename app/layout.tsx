import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import Script from "next/script";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Starry Night",
  description: "A modernized homage to the After Dark Starry Night screensaver.",
};

// three r184 deprecated THREE.Clock (it warns in its constructor), but @react-three/fiber 9.6.1
// still does `new THREE.Clock()` for state.clock on every Canvas root — so the deprecation spams
// the console on every mount / HMR / navigation. It's a benign upstream notice (R3F will move to
// THREE.Timer). Drop just that one message, before hydration so the first Canvas is covered too.
// Remove once R3F is on THREE.Timer.
const silenceClockDeprecation = `
(function(){try{
  var w=console.warn;
  console.warn=function(){
    var a=arguments[0];
    if(typeof a==="string"&&a.indexOf("Clock: This module has been deprecated")!==-1)return;
    return w.apply(console,arguments);
  };
}catch(e){}})();
`;

// Runs before React hydrates; reads the persisted theme from localStorage and
// stamps the class on <html> so the first paint is correct (no light-flash on
// dark theme, no double-class hydration mismatch with the runtime hook).
const themeBootstrap = `
(function(){try{
  var t=localStorage.getItem("starry-night.theme");
  if(t!=="light"&&t!=="grey"&&t!=="dark")t="dark";
  var c=document.documentElement.classList;
  c.remove("light","grey","dark");
  c.add(t);
}catch(e){document.documentElement.classList.add("dark");}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <head>
        {/* next/script (beforeInteractive) injects this into the document
            before hydration — a raw <script> JSX node throws a Next 16 / React
            19 client-render warning ("scripts inside React components are never
            executed when rendering on the client") and pops the dev overlay. */}
        <Script
          id="silence-clock-deprecation"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: silenceClockDeprecation }}
        />
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
