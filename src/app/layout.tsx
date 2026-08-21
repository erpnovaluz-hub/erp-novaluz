import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Novaluz",
  description: "ERP modular com CRM embutido — MSFORT",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
