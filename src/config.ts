import type { Config } from "./types.js";

const config: Config = {
  site: {
    title: "shitposts.org",
    author: "shitposts.org",
    description:
      "A parody research journal where AI generates absurd academic papers about impossible, ridiculous, and wildly speculative topics. AI-generated satire, fake academic papers, and parody research.",
    url: "https://shitposts.org",
    ogImage: "/static/og/og-image.png",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: "shitposts.org — AI-generated satire research journal",
  },

  dirs: {
    pages: "./src/content/pages",
    research: "./src/content/research",
    public: "./public",
    dist: "./dist",
    layouts: "./layouts",
  },

  blogBasePath: "/research",

  research: {
    categoryWhitelist: [
      "Tech",
      "Physics",
      "Life",
      "Earth",
      "People",
      "Math",
      "Methods",
      "Ideas",
      "Society",
      "Culture",
      "Systems",
      "Health",
      "Arts",
    ],
  },

  routes: {
    "/": "index.md",
    "/scope": "scope.md",
  },

  date: {
    locale: "en-US",
    options: {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    },
  },

  styles: {},

  placeholders: {
    sidenote: "SNOTE",
    marginnote: "MNOTE",
    fold: "FOLD",
  },

  rss: {
    enabled: true,
    title: "shitposts.org — Parody Research Journal",
    description:
      "AI-generated absurd academic papers: fake research, parody methodology, and satire. Ridiculous topics, scholarly style.",
    language: "en",
    copyright: "Copyright © 2026 shitposts.org",
    items: { limit: 200 },
  },

  sitemap: {
    enabled: true,
    changefreq: "weekly",
    priority: { home: 1.0, pages: 0.8, blog: 0.9, posts: 0.7 },
  },

  robots: {
    enabled: true,
    userAgent: "*",
    allow: ["/"],
    disallow: [],
    crawlDelay: 1,
  },

  llms: {
    enabled: true,
    summary:
      "shitposts.org is a parody research journal. AI-generated articles mimic academic papers (abstract, methodology, citations) on absurd, speculative, or surreal topics. Content is for humor, satire, and creative exploration—not real research. Keywords: AI generated research papers, fake academic papers, parody research journal, absurd scientific papers, AI humor, academic satire.",
  },

  nav: [
    { name: "Editorial", path: "/", show: true },
    { name: "Scope", path: "/scope", show: true },
    { name: "Research", path: "/research", show: true },
    { name: "Categories", path: "/research/categories", show: true },
  ],

  cdn: "",
};

export default config;
