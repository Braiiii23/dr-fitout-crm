import "./globals.css";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "ENP Fitouts · DR Fitout — Leads",
  description: "Private leads CRM",
  robots: { index: false, follow: false },
  applicationName: "ENP Leads",
  appleWebApp: { capable: true, title: "ENP Leads", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#111113" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-AU"><body>{children}</body></html>);
}
