import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visio — gestion budgétaire",
  description: "Gérez votre budget en enveloppes emboîtées, en ligne ou hors-ligne.",
  manifest: "/manifest.json",
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Visio" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#158454",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
