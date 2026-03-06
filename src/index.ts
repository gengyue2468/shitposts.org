import { join, dirname } from "path";
import { stat, rm, readdir } from "fs/promises";
import { ensureDir, loadLayout, copyPublicFiles, writeFileContent } from "./utils/fs.js";
import { buildPage, getInlinedCss } from "./builders/page.js";
import { buildResearchIndex, buildResearchPosts, buildTagPages } from "./builders/research.js";
import { generateRSS } from "./generators/rss.js";
import { generateSitemap } from "./generators/sitemap.js";
import { generateRobotsTxt } from "./generators/robots.js";
import { emitMarkdownFiles, generateLlmsTxt } from "./generators/llms.js";
import { registerPlugin } from "./extensions/plugin.js";
import { mermaidPlugin } from "./extensions/mermaid.js";
import config from "./config.js";

// Register plugins
registerPlugin(mermaidPlugin);

// Performance timer utility
class PerformanceTimer {
  private times = new Map<string, number>();
  private results: Array<{ name: string; duration: number }> = [];

  start(name: string): void {
    this.times.set(name, performance.now());
  }

  end(name: string): number {
    const start = this.times.get(name);
    if (start === undefined) return 0;
    const duration = performance.now() - start;
    this.results.push({ name, duration });
    return duration;
  }

  report(): void {
    console.log("\n📊 Build Performance Report:");
    console.log("─".repeat(50));
    let total = 0;
    for (const { name, duration } of this.results) {
      total += duration;
      console.log(`  ${name.padEnd(30)} ${duration.toFixed(2).padStart(8)}ms`);
    }
    console.log("─".repeat(50));
    console.log(`  ${"TOTAL".padEnd(30)} ${total.toFixed(2).padStart(8)}ms`);
  }
}

const timer = new PerformanceTimer();

async function build(): Promise<void> {
  console.log("📦 Building site...\n");
  timer.start("total");

  timer.start("setup");
  await ensureDir(config.dirs.dist);

  // Load layouts in parallel
  const [baseLayout, pageLayout, researchIndexLayout, researchPostLayout, tagsLayout] = await Promise.all([
    loadLayout("base", config.dirs.layouts),
    loadLayout("page", config.dirs.layouts),
    loadLayout("research-index", config.dirs.layouts),
    loadLayout("research-post", config.dirs.layouts),
    loadLayout("tags", config.dirs.layouts),
  ]);

  const currentYear = new Date().getFullYear();
  const inlinedCss = await getInlinedCss();
  timer.end("setup");

  const defaultOgImageUrl = config.site.ogImage
    ? (config.cdn || config.site.url).replace(/\/$/, "") + config.site.ogImage
    : undefined;

  // Build static pages in parallel
  timer.start("static-pages");
  const staticPagePromises: Promise<void>[] = [];

  for (const [route, file] of Object.entries(config.routes)) {
    if (route === (config.blogBasePath ?? "/blog")) continue;
    const filePath = join(config.dirs.pages, file);

    staticPagePromises.push(
      (async () => {
        try {
          await stat(filePath);
          await buildPage(route, filePath, baseLayout, pageLayout, currentYear, defaultOgImageUrl);
          console.log(`✓ Built ${route}`);
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code === "ENOENT") {
            console.warn(`⚠ Warning: ${filePath} not found, skipping ${route}`);
          } else {
            throw err;
          }
        }
      })()
    );
  }

  await Promise.all(staticPagePromises);
  timer.end("static-pages");

  // Build research
  timer.start("research-index");
  const posts = await buildResearchIndex(baseLayout, researchIndexLayout, currentYear, inlinedCss);
  timer.end("research-index");

  timer.start("research-posts");
  await buildResearchPosts(posts, baseLayout, researchPostLayout, currentYear, inlinedCss);
  timer.end("research-posts");

  // Remove stale post directories from dist that no longer have a source file
  timer.start("cleanup-stale");
  const researchDistDir = join(config.dirs.dist, researchDistSegment);
  try {
    const activeSlugs = new Set(posts.map((p) => p.slug));
    const distEntries = await readdir(researchDistDir, { withFileTypes: true });
    await Promise.all(
      distEntries
        .filter((e) => e.isDirectory() && e.name !== "categories" && !activeSlugs.has(e.name))
        .map((e) => {
          console.log(`🗑 Removing stale: ${researchBasePath}/${e.name}`);
          return rm(join(researchDistDir, e.name), { recursive: true, force: true });
        })
    );
  } catch {
    // dist/research may not exist yet on first run
  }
  timer.end("cleanup-stale");

  // Build tag pages
  timer.start("tag-pages");
  await buildTagPages(posts, baseLayout, tagsLayout, currentYear, inlinedCss);
  timer.end("tag-pages");

  // Generate feeds in parallel
  timer.start("feeds");
  const feedPromises: Promise<void>[] = [];

  if (config.rss.enabled) {
    feedPromises.push(generateRSS(posts));
  }
  if (config.sitemap.enabled) {
    feedPromises.push(generateSitemap(posts));
  }
  if (config.robots.enabled) {
    feedPromises.push(generateRobotsTxt());
  }

  await Promise.all(feedPromises);
  timer.end("feeds");

  // LLM-friendly outputs
  if (config.llms.enabled) {
    timer.start("llms");
    await Promise.all([
      emitMarkdownFiles(posts),
      generateLlmsTxt(posts),
    ]);
    timer.end("llms");
  }

  // Build 404 page
  timer.start("404-page");
  const filePath404 = join(config.dirs.pages, "404.md");
  try {
    await stat(filePath404);
    await buildPage("/404", filePath404, baseLayout, pageLayout, currentYear, defaultOgImageUrl);

    // Copy 404/index.html to 404.html and remove directory
    const dist404DirPath = join(config.dirs.dist, "404", "index.html");
    const dist404Path = join(config.dirs.dist, "404.html");
    try {
      const file404 = Bun.file(dist404DirPath);
      const content = await file404.text();
      await writeFileContent(dist404Path, content);
      await rm(join(config.dirs.dist, "404"), { recursive: true, force: true });
    } catch { /* ignore */ }
    console.log("✓ Built /404");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      throw err;
    }
  }
  timer.end("404-page");

  // Copy public files
  timer.start("copy-public");
  await copyPublicFiles(config.dirs);
  timer.end("copy-public");

  timer.end("total");
  timer.report();

  console.log("\n✓ Build complete!");
}

// Run build
build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
