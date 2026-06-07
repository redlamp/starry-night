import { IntroApp } from "@/components/intro/IntroApp";

export const metadata = { title: "Starry Night - Intro" };

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <IntroApp />
      <p className="pointer-events-none absolute right-3 bottom-2 text-[10px] text-neutral-500">
        <a
          className="pointer-events-auto underline-offset-2 hover:underline"
          href="https://skfb.ly/6SLnE"
          target="_blank"
          rel="noreferrer"
        >
          &ldquo;Macintosh 128K Computer (1984)&rdquo;
        </a>{" "}
        by Daz,{" "}
        <a
          className="pointer-events-auto underline-offset-2 hover:underline"
          href="http://creativecommons.org/licenses/by-nc/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY-NC 4.0
        </a>
      </p>
    </main>
  );
}
