import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "koota-kit",
  siteUrl: "https://jonbogaty.com",
  baseUrl: "/koota-kit",
  theme: {
    preset: "default",
    colors: {
      primary: "#1c3a52",
      light: "#377eb7",
      dark: "#0d1b26",
    },
    fonts: {
      sans: "system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    layout: {
      sidebar: "17rem",
      toc: "18rem",
      content: "46rem",
    },
    css: ["./brand.css"],
  },
  logo: { light: "./assets/koota-kit-hero.webp", href: "/koota-kit/" },
  favicon: "./assets/favicon.svg",
  // The rendered static OG card uses the project hero already validated for
  // GitHub README use; an explicit URL avoids an image-generation dependency
  // in documentation CI.
  ogImage:
    "https://raw.githubusercontent.com/jbcom/koota-kit/main/docs/assets/koota-kit-hero.webp",
  repo: "https://github.com/jbcom/koota-kit",
  editBranch: "main",
  editBasePath: "docs",
  prettyUrls: "slash",
  navbar: {
    links: [
      { type: "github", href: "https://github.com/jbcom/koota-kit" },
      { label: "npm", href: "https://www.npmjs.com/package/koota-kit" },
    ],
  },
  footer: {
    links: [
      { label: "MIT License", href: "https://github.com/jbcom/koota-kit/blob/main/LICENSE" },
      { label: "Security", href: "https://github.com/jbcom/koota-kit/security/policy" },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          groups: [
            {
              group: "Getting Started",
              pages: ["introduction", "getting-started"],
            },
            {
              group: "Guides",
              pages: ["determinism", "persistence", "event-logs"],
            },
            {
              group: "Reference",
              pages: ["API", "ARCHITECTURE"],
            },
            {
              group: "Project",
              pages: ["contributing", "release-history"],
            },
          ],
        }),
      },
    ],
  },
});
