import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Starry Night",
  description: "A modernized homage to the After Dark Starry Night screensaver.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
