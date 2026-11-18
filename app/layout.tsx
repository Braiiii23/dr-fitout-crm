import "./globals.css";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "DR Fitout — CRM",
  description: "Private leads CRM",
  robots: { index: false, follow: false },
  applicationName: "DR Fitout CRM",
  appleWebApp: { capable: true, title: "DR Fitout CRM", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#2e1546" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-AU"><body>{children}</body></html>);
}
