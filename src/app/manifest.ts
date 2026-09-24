import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ERP Novaluz",
    short_name: "Novaluz",
    description: "Sistema de gestão integrado — tarefas, OS, estoque e compras",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1e40af",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // atalhos ao segurar o ícone (Android / desktop)
    shortcuts: [
      { name: "Minhas tarefas", url: "/tarefas", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Caixa de entrada", url: "/tarefas/caixa", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Projetos", url: "/tarefas/projetos", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
