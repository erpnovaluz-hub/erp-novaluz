import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaProvider from "@/components/pwa/PwaProvider";

export const metadata: Metadata = {
  title: "ERP Novaluz",
  description: "ERP modular com CRM embutido — MSFORT",
  applicationName: "Novaluz",
  // iPhone: abre em tela cheia quando instalado pela "Tela de Início"
  appleWebApp: { capable: true, title: "Novaluz", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",        // usa a área do notch; o layout respeita env(safe-area-inset-*)
  themeColor: "#1e40af",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body><PwaProvider>{children}</PwaProvider></body>
    </html>
  );
}
