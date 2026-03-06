import { join, dirname, extname, basename } from "path";
import { readdir } from "fs/promises";
import { ensureDir, writeFileContent } from "../utils/fs.js";
import { renderMarkdown } from "../utils/markdown.js";
import { renderTemplate, renderNav } from "../utils/template.js";
import { formatDate } from "../utils/date.js";
import { hasMermaidCode as checkMermaidCode, mermaidScript } from "../extensions/mermaid.js";
import config from "../config.js";
import type { Post } from "../types.js";

const researchBasePath = config.blogBasePath ?? "/research";
const researchDistSegment = researchBasePath.replace(/^\//, "");

/** Author from post frontmatter (who actually wrote it) or fallback. */
function getPostAuthor(frontmatter: Record<string, unknown>): string {
  const model = (frontmatter.author_model as string) || (frontmatter.model as string);
  if (model) return model;
  return process.env.OPENAI_MODEL || config.site.author;
}

// Extended post with pre-rendered content
interface PostWithContent extends Post {
  html: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Truncate description to optimal length for SEO (150 chars)
 */
function truncateDescription(description: string, maxLength = 150): string {
  if (description.length <= maxLength) return description;
  const truncated = description.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf("。");
  const lastSpace = truncated.lastIndexOf(" ");
  const cutoff = lastPeriod > 0 ? lastPeriod + 1 : (lastSpace > 0 ? lastSpace : maxLength);
  return truncated.substring(0, cutoff) + "...";
}

function generatePostTitle(postTitle: string, _tags?: string[]): string {
  const siteName = config.site.title;
  return `${postTitle} - ${siteName}`;
}

function generateKeywords(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  const keywords = tags.join(", ");
  return `<meta name="keywords" content="${keywords}" />`;
}

function generateOgTags(
  title: string,
  description: string,
  url: string,
  type: string,
  tags?: string[],
  ogImageUrl?: string,
  ogImageWidth?: number,
  ogImageHeight?: number,
  ogImageAlt?: string
): string {
  const parts: string[] = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${truncateDescription(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${config.site.title}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${truncateDescription(description)}" />`,
  ];
  if (ogImageUrl) {
    parts.push(`<meta property="og:image" content="${ogImageUrl}" />`);
    if (ogImageWidth) parts.push(`<meta property="og:image:width" content="${ogImageWidth}" />`);
    if (ogImageHeight) parts.push(`<meta property="og:image:height" content="${ogImageHeight}" />`);
    if (ogImageAlt) parts.push(`<meta property="og:image:alt" content="${ogImageAlt}" />`);
    parts.push(`<meta name="twitter:image" content="${ogImageUrl}" />`);
  }
  if (tags && tags.length > 0) {
    parts.push(`<meta name="twitter:label1" content="Tags" />`);
    parts.push(`<meta name="twitter:data1" content="${tags.slice(0, 3).join(", ")}" />`);
  }
  return parts.join("\n    ");
}

function generateJsonLd(
  title: string,
  description: string,
  url: string,
  date: string | undefined,
  tags: string[] | undefined
): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description: truncateDescription(description),
    url: url,
    author: { "@type": "Person", name: config.site.author },
    publisher: { "@type": "Person", name: config.site.author },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
  if (date) data.datePublished = new Date(date).toISOString();
  if (tags && tags.length > 0) data.keywords = tags.join(", ");
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function generateResearchIndexJsonLd(
  title: string,
  description: string,
  url: string,
  numberOfItems: number
): string {
  const baseUrl = config.site.url.replace(/\/$/, "");
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    url,
    name: title,
    description: truncateDescription(description),
    numberOfItems,
    isPartOf: { "@type": "WebSite", name: config.site.title, url: baseUrl + "/" },
  };
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function getTagSlug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
}

function generateTagsHTML(allTags: string[]): string {
  const tagCounts: Record<string, number> = {};
  for (const tag of allTags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  const sortedTags = [...new Set(allTags)].sort((a, b) => {
    const countDiff = tagCounts[b]! - tagCounts[a]!;
    return countDiff !== 0 ? countDiff : a.localeCompare(b);
  });
  const parts: string[] = ['<div class="tags-list">'];
  for (const tag of sortedTags) {
    const slug = getTagSlug(tag);
    const count = tagCounts[tag]!;
    const size = Math.min(3, Math.max(1, Math.ceil(count / 2)));
    parts.push(
      `<a href="${researchBasePath}/categories/${slug}" class="tag tag-size-${size}" data-count="${count}">${tag} <span class="tag-count">(${count})</span></a>`
    );
  }
  parts.push("</div>");
  return parts.join("");
}

function generatePostTagsHTML(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  const parts: string[] = ['<div class="post-tags" style="margin-top: 2rem; margin-bottom: 1rem;">'];
  for (const tag of tags) {
    const slug = getTagSlug(tag);
    parts.push(`<a href="${researchBasePath}/categories/${slug}" class="tag">${tag}</a>`);
  }
  parts.push("</div>");
  return parts.join("");
}

function formatFancyDateTime(dateString: string | undefined): string {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";

  const year = d.getUTCFullYear();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = monthNames[d.getUTCMonth()]!;

  const day = d.getUTCDate();
  const daySuffix = (() => {
    if (day % 100 >= 11 && day % 100 <= 13) return "th";
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  })();

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = weekdayNames[d.getUTCDay()]!;

  return `<h3>${year}</h3><h3>${weekday}, ${month} ${day}${daySuffix}</h3>`;
}

function formatTimeOnly(dateString: string | undefined): string {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toISOString().slice(11, 19); // HH:MM:SS (UTC)
  return `at ${time} UTC`;
}

function formatFullDateTime(dateString: string | undefined): string {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";

  const year = d.getUTCFullYear();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = monthNames[d.getUTCMonth()]!;
  const day = d.getUTCDate();
  const time = d.toISOString().slice(11, 19); // HH:MM:SS (UTC)
  return `${month} ${day}, ${year} at ${time} UTC`;
}

function getDateKey(dateString: string | undefined): string {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function generatePostsListHTML(posts: Post[]): string {
  if (posts.length === 0) return "<p>No research found.</p>";

  const postsByDate: Record<string, Post[]> = {};
  for (const post of posts) {
    const key = getDateKey(post.date);
    const groupKey = key || "unknown";
    if (!postsByDate[groupKey]) postsByDate[groupKey] = [];
    postsByDate[groupKey]!.push(post);
  }

  const dateKeys = Object.keys(postsByDate).sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });

  const parts: string[] = [];
  for (const key of dateKeys) {
    const datePosts = postsByDate[key]!;
    if (key !== "unknown") {
      const headingHtml = formatFancyDateTime(datePosts[0]?.date);
      parts.push(headingHtml || `<h3>${key}</h3>`);
    } else {
      parts.push("<h3>Unknown date</h3>");
    }
    parts.push('<ul class="posts-list">');
    for (const post of datePosts) {
      parts.push(`<li class="post-item">`);
      parts.push(`<a href="${researchBasePath}/${post.slug}">${post.title}</a>`);
      if (post.date)
        parts.push(` <span class="post-date-inline">${formatTimeOnly(post.date)}</span>`);
      parts.push("</li>");
    }
    parts.push("</ul>");
  }
  return parts.join("");
}

export async function buildResearchIndex(
  baseLayout: string,
  researchIndexLayout: string,
  year?: number,
  css?: string
): Promise<PostWithContent[]> {
  const researchDir = config.dirs.research;
  const posts: PostWithContent[] = [];
  try {
    const files = await readdir(researchDir);
    const mdFiles = files.filter((file) => extname(file) === ".md");
    const postPromises = mdFiles.map(async (file) => {
      const filePath = join(researchDir, file);
      const { frontmatter, html } = await renderMarkdown(filePath);
      const slug = basename(file, ".md");
      const rawCategories =
        (frontmatter.categories as string[]) || (frontmatter.tags as string[]) || [];
      const categories = Array.from(new Set((rawCategories || []).map((t) => String(t))));
      return {
        slug,
        title: (frontmatter.title as string) || slug,
        date: (frontmatter.date as string) || "",
        excerpt: (frontmatter.excerpt as string) || "",
        summary: (frontmatter.summary as string) || "",
        tags: categories,
        html,
        filePath,
        frontmatter,
      };
    });
    const results = await Promise.all(postPromises);
    posts.push(...results);
  } catch {
    // Research directory doesn't exist
  }
  posts.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
  const allTags: string[] = [];
  for (const post of posts) {
    if (post.tags && Array.isArray(post.tags)) allTags.push(...post.tags);
  }
  const tagsHtml = generateTagsHTML(allTags);
  const postsListHtml = posts.length > 0 ? generatePostsListHTML(posts) : "<p>No research yet.</p>";
  const tagsSection = `<div style="margin-top: 3rem;">${tagsHtml}</div>`;
  const contentData = { title: "Research", postsList: postsListHtml + tagsSection };
  const renderedContent = renderTemplate(researchIndexLayout, contentData);
  const researchBasePathUrl = `${config.site.url}${researchBasePath}`;
  const researchBasePathTitle = `Research - ${config.site.title}`;
  const ogImageBase = config.site.ogImage
    ? (config.cdn || config.site.url).replace(/\/$/, "") + config.site.ogImage
    : undefined;
  const baseData = {
    title: researchBasePathTitle,
    siteTitle: config.site.title,
    description: truncateDescription(config.site.description),
    author: config.site.author,
    year: year?.toString() || new Date().getFullYear().toString(),
    content: renderedContent,
    css: css || "",
    nav: renderNav(config.nav),
    scripts: "",
    footerLlms: config.llms?.enabled ? ' | <a href="/llms.txt">llms.txt</a>' : "",
    canonicalUrl: researchBasePathUrl,
    keywords: "",
    ogTags: generateOgTags(
      researchBasePathTitle,
      config.site.description,
      researchBasePathUrl,
      "website",
      undefined,
      ogImageBase,
      config.site.ogImageWidth,
      config.site.ogImageHeight,
      config.site.ogImageAlt
    ),
    jsonLd: generateResearchIndexJsonLd(researchBasePathTitle, config.site.description, researchBasePathUrl, posts.length),
    htmlLang: "en",
  };
  const output = renderTemplate(baseLayout, baseData);
  const outputPath = join(config.dirs.dist, researchDistSegment, "index.html");
  await ensureDir(dirname(outputPath));
  await writeFileContent(outputPath, output);
  console.log(`✓ Built ${researchBasePath} -> ${outputPath}`);
  return posts;
}

export async function buildResearchPosts(
  posts: PostWithContent[],
  baseLayout: string,
  researchPostLayout: string,
  year?: number,
  css?: string
): Promise<void> {
  const buildPromises = posts.map(async (post, i) => {
    const { html, frontmatter } = post;
    const title = (frontmatter.title as string) || post.slug;
    const formattedDate = formatFullDateTime(frontmatter.date as string);
    const prevPost = i > 0 ? posts[i - 1]! : null;
    const nextPost = i < posts.length - 1 ? posts[i + 1]! : null;
    let navHtml = "";
    if (prevPost || nextPost) {
      const navParts: string[] = [`<nav class="post-nav">`];
      if (prevPost) navParts.push(`<a href="${researchBasePath}/${prevPost.slug}">← ${prevPost.title}</a>`);
      if (nextPost) navParts.push(`<a href="${researchBasePath}/${nextPost.slug}">${nextPost.title} →</a>`);
      navParts.push("</nav>");
      navHtml = navParts.join("");
    }
    const postCats = (frontmatter.categories ?? frontmatter.tags) as string[] | undefined;
    const postTagsHtml = generatePostTagsHTML(postCats);
    const dateClass = formattedDate ? "" : " hidden";
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCountNum = plainText ? plainText.split(/\s+/).length : 0;
    const wordCountDisplay = `${wordCountNum.toLocaleString()} words`;
    const sourceMdLink = config.llms?.enabled
      ? `<a href="${researchBasePath}/${post.slug}.md" class="md-link">.md</a>`
      : "";
    const datePart = formattedDate
      ? ` · <span class="post-date${dateClass}">${formattedDate}</span>`
      : "";
    const authorName = getPostAuthor(frontmatter);
    const authorIntro =
      process.env.OPENAI_MODEL_INTRO || `By ${authorName} for shitposts.org.`;
    const contentData = {
      title,
      date: formattedDate,
      dateClass,
      dateSeparator: formattedDate ? " · " : "",
      wordCountDisplay,
      datePart,
      authorName,
      authorIntro,
      content: html,
      tags: postTagsHtml,
      navigation: navHtml,
      sourceMdLink,
    };
    const renderedContent = renderTemplate(researchPostLayout, contentData);
    const description = (frontmatter.summary as string) || config.site.description;
    const hasMermaid = html.includes('class="mermaid"') || checkMermaidCode(html);
    const scripts = hasMermaid ? mermaidScript : "";
    const postUrl = `${config.site.url}${researchBasePath}/${post.slug}`;
    const postCatsForMeta = (frontmatter.categories ?? frontmatter.tags) as string[] | undefined;
    const fullTitle = generatePostTitle(title, postCatsForMeta);
    const ogImageBase = config.site.ogImage
      ? (config.cdn || config.site.url).replace(/\/$/, "") + config.site.ogImage
      : undefined;
    const htmlLang = (frontmatter.lang as string) || "en";
    const baseData = {
      title: fullTitle,
      siteTitle: config.site.title,
      description: truncateDescription(description),
      author: config.site.author,
      year: year?.toString() || new Date().getFullYear().toString(),
      content: renderedContent,
      css: css || "",
      nav: renderNav(config.nav),
      scripts,
      footerLlms: config.llms?.enabled ? ' | <a href="/llms.txt">llms.txt</a>' : "",
      canonicalUrl: postUrl,
      keywords: generateKeywords(postCatsForMeta),
      ogTags: generateOgTags(
        fullTitle,
        description,
        postUrl,
        "article",
        postCatsForMeta,
        ogImageBase,
        config.site.ogImageWidth,
        config.site.ogImageHeight,
        config.site.ogImageAlt
      ),
      jsonLd: generateJsonLd(title, description, postUrl, frontmatter.date as string, postCatsForMeta),
      htmlLang,
    };
    const output = renderTemplate(baseLayout, baseData);
    const outputPath = join(config.dirs.dist, researchDistSegment, post.slug, "index.html");
    await ensureDir(dirname(outputPath));
    await writeFileContent(outputPath, output);
    console.log(`✓ Built ${researchBasePath}/${post.slug}`);
  });
  await Promise.all(buildPromises);
}

export async function buildTagPages(
  posts: PostWithContent[],
  baseLayout: string,
  tagsLayout: string,
  year?: number,
  css?: string
): Promise<void> {
  const tagMap = new Map<string, Post[]>();
  for (const post of posts) {
    if (post.tags && Array.isArray(post.tags)) {
      for (const tag of post.tags) {
        const existing = tagMap.get(tag) || [];
        existing.push(post);
        tagMap.set(tag, existing);
      }
    }
  }
  if (tagMap.size === 0) return;
  const tagPromises: Promise<void>[] = [];
  for (const [tag, taggedPosts] of tagMap) {
    const promise = (async () => {
      const slug = getTagSlug(tag);
      taggedPosts.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
      const allTags: string[] = [];
      for (const post of posts) {
        if (post.tags && Array.isArray(post.tags)) allTags.push(...post.tags);
      }
      const tagNavHtml = generateTagsHTML(allTags);
      const postsListHtml = generatePostsListHTML(taggedPosts);
      const categoriesBlurb = `
<p>Below is a subset of researches that currently gravitate toward the <strong>${tag}</strong> category. Categories on shitposts.org are intentionally broad and slightly fuzzy: they are there to hint at which part of the absurd landscape you are entering, not to enforce a rigid ontology.</p>
<p>Over time, as more items accumulate, overlaps between categories (Tech with People, Physics with Life, Math with Ideas, and so on) are expected rather than treated as mistakes. You may think of this page as a temporary weather report for this particular region: a snapshot of where the models have recently chosen to ramble.</p>
<p>If you do not find what you were hoping for here, you may wander into neighboring categories, or send a speculative complaint or suggestion to <strong>contact@shitposts.org</strong>. We make no promises about the outcome, but we do acknowledge the gesture.</p>
`;
      const contentData = { title: `Category: ${tag}`, tagsList: tagNavHtml, postsList: postsListHtml, categoriesBlurb };
      const renderedContent = renderTemplate(tagsLayout, contentData);
      const tagUrl = `${config.site.url}${researchBasePath}/categories/${slug}`;
      const tagDescription = `Researches in category "${tag}" - ${config.site.title}`;
      const tagPageTitle = `${tag} - ${config.site.title}`;
      const ogImageBase = config.site.ogImage
        ? (config.cdn || config.site.url).replace(/\/$/, "") + config.site.ogImage
        : undefined;
      const baseData = {
        title: tagPageTitle,
        siteTitle: config.site.title,
        description: truncateDescription(tagDescription),
        author: config.site.author,
        year: year?.toString() || new Date().getFullYear().toString(),
        content: renderedContent,
        css: css || "",
        nav: renderNav(config.nav),
        scripts: "",
        footerLlms: config.llms?.enabled ? ' | <a href="/llms.txt">llms.txt</a>' : "",
        canonicalUrl: tagUrl,
        keywords: generateKeywords([tag]),
        ogTags: generateOgTags(
          tagPageTitle,
          tagDescription,
          tagUrl,
          "website",
          [tag],
          ogImageBase,
          config.site.ogImageWidth,
          config.site.ogImageHeight,
          config.site.ogImageAlt
        ),
        jsonLd: "",
      };
      const output = renderTemplate(baseLayout, baseData);
      const outputPath = join(config.dirs.dist, researchDistSegment, "categories", slug, "index.html");
      await ensureDir(dirname(outputPath));
      await writeFileContent(outputPath, output);
      console.log(`✓ Built ${researchBasePath}/categories/${slug}`);
    })();
    tagPromises.push(promise);
  }
  await Promise.all(tagPromises);
  await buildTagIndexPage(posts, baseLayout, tagsLayout, year, css);
}

async function buildTagIndexPage(
  posts: PostWithContent[],
  baseLayout: string,
  tagsLayout: string,
  year?: number,
  css?: string
): Promise<void> {
  const allTags: string[] = [];
  for (const post of posts) {
    if (post.tags && Array.isArray(post.tags)) allTags.push(...post.tags);
  }
  if (allTags.length === 0) return;
  const tagCounts: Record<string, number> = {};
  for (const tag of allTags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  const sortedTags = [...new Set(allTags)].sort((a, b) => {
    const countDiff = tagCounts[b]! - tagCounts[a]!;
    return countDiff !== 0 ? countDiff : a.localeCompare(b);
  });
  const tagsListParts: string[] = ['<div class="tags-cloud">'];
  for (const tag of sortedTags) {
    const slug = getTagSlug(tag);
    const count = tagCounts[tag]!;
    const size = Math.min(3, Math.max(1, Math.ceil(count / 2)));
    tagsListParts.push(
      `<a href="${researchBasePath}/categories/${slug}" class="tag tag-size-${size}" data-count="${count}">${tag} <span class="tag-count">(${count})</span></a>`
    );
  }
  tagsListParts.push("</div>");
  const tagsCloudHtml = tagsListParts.join("");
  const categoriesBlurb = `
<p>The categories below are a compact, journal-style map of the territory that shitposts.org pretends to cover: short labels like <strong>Tech</strong>, <strong>Physics</strong>, <strong>Life</strong>, <strong>People</strong>, or <strong>Ideas</strong> that gesture toward, rather than precisely define, a domain.</p>
<p>Assignments are made by the same models that write the researches, guided by prompts instead of committees. As a result, the distribution is uneven and continuously shifting: some regions become dense, others remain sparse, and the workflow gently nudges new pieces toward underused areas so that, in the long run, every category gets at least a little attention.</p>
<p>You may treat this page as a weather map for the journal: a quick way to see which parts of the landscape are currently stormy with activity and which are waiting for the next speculative manuscript. If you have strong feelings about how things are grouped, you are welcome to send them to <strong>contact@shitposts.org</strong>. We reserve the right to consider your taxonomical arguments over coffee and then ignore them.</p>
`;
  const contentData = {
    title: "All Categories",
    tagsList: "",
    postsList: `<p>${sortedTags.length} category(ies), ${posts.length} research(es).</p>${tagsCloudHtml}`,
    categoriesBlurb,
  };
  const renderedContent = renderTemplate(tagsLayout, contentData);
  const tagsIndexUrl = `${config.site.url}${researchBasePath}/categories`;
  const tagsIndexDescription = `All categories - ${config.site.title}`;
  const tagsIndexTitle = `Categories - ${config.site.title}`;
  const ogImageBase = config.site.ogImage
    ? (config.cdn || config.site.url).replace(/\/$/, "") + config.site.ogImage
    : undefined;
  const baseData = {
    title: tagsIndexTitle,
    siteTitle: config.site.title,
    description: truncateDescription(tagsIndexDescription),
    author: config.site.author,
    year: year?.toString() || new Date().getFullYear().toString(),
    content: renderedContent,
    css: css || "",
    nav: renderNav(config.nav),
    scripts: "",
    footerLlms: config.llms?.enabled ? ' | <a href="/llms.txt">llms.txt</a>' : "",
    canonicalUrl: tagsIndexUrl,
    keywords: "",
    ogTags: generateOgTags(
      tagsIndexTitle,
      tagsIndexDescription,
      tagsIndexUrl,
      "website",
      undefined,
      ogImageBase,
      config.site.ogImageWidth,
      config.site.ogImageHeight,
      config.site.ogImageAlt
    ),
    jsonLd: "",
  };
  const output = renderTemplate(baseLayout, baseData);
  const outputPath = join(config.dirs.dist, researchDistSegment, "categories", "index.html");
  await ensureDir(dirname(outputPath));
  await writeFileContent(outputPath, output);
  console.log(`✓ Built ${researchBasePath}/categories -> ${outputPath}`);
}
