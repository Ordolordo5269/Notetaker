import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/app/providers";
import { ServiceWorker } from "@/components/app/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StudyFlow AI", template: "%s · StudyFlow AI" },
  description: "Graba tus clases, transcríbelas en su idioma original y conviértelas en apuntes de estudio.",
  applicationName: "StudyFlow AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "StudyFlow", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121413" },
  ],
};

// Applies the saved theme before first paint (no light/dark flash).
const themeScript = `(function(){try{var t=localStorage.getItem("sf-theme");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
