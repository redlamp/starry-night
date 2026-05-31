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
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
