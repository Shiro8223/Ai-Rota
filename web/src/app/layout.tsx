import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/sw-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Rota Agent",
  description: "Plain-English rules, fair weekly rotas, swaps that respect the rules.",
  appleWebApp: { capable: true, title: "Rota", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a7a57", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-screen">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
