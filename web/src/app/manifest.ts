import type { MetadataRoute } from "next";

/** Installable staff app: "Add to home screen" opens straight to My shifts. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rota Agent",
    short_name: "Rota",
    description: "Your shifts, swaps, holiday and clock-in.",
    start_url: "/me",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#1a7a57",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
