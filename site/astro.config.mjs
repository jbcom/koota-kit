// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://jonbogaty.com",
  base: "/koota-kit",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "koota-kit",
      description:
        "Deterministic Koota simulation conventions: world lifecycle, dual RNG streams, safe object traits, and world-scoped event logs.",
      logo: {
        src: "./src/assets/koota-kit-hero.webp",
        replacesTitle: false,
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/jbcom/koota-kit" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@jbdevprimary/koota-kit" },
      ],
      editLink: {
        baseUrl: "https://github.com/jbcom/koota-kit/edit/main/site/",
      },
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        { label: "API Reference", slug: "api" },
        { label: "Architecture", slug: "architecture" },
      ],
    }),
  ],
});
