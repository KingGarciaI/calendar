import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MVMNT OS",
    short_name: "MVMNT OS",
    description: "Calendrier, tâches et assistant personnel de MVMNT.",
    lang: "fr-CA",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0e1b",
    theme_color: "#0c0e1b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Aujourd'hui", url: "/today" },
      { name: "Calendrier", url: "/calendar" },
      { name: "Assistant", url: "/assistant" },
    ],
  };
}
