#!/usr/bin/env bun

import OpenAI from "openai";
import { join } from "path";
import { writeFile, mkdir, readFile, readdir } from "fs/promises";
import matter from "gray-matter";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || undefined;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY. Copy .env.example to .env and set it.");
  process.exit(1);
}

const RESEARCH_DIR = join(process.cwd(), "src", "content", "research");

const SHITPOSTS_INTRO = `shitposts.org is an open-access, interdisciplinary research journal that welcomes speculative and non-traditional contributions. The venue provides publication opportunities for a variety of authors and encourages rigorous but exploratory work across domains.`;

type Lang = "en" | "zh";

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

type TagCluster = { tags: string[]; score: number };

async function buildTagContext(): Promise<string> {
  let files: string[] = [];
  try {
    files = (await readdir(RESEARCH_DIR)).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    return "Existing tag vocabulary: (none found yet)\n";
  }

  const posts: string[][] = [];
  for (const f of files) {
    try {
      const content = await readFile(join(RESEARCH_DIR, f), "utf8");
      const fm = matter(content).data as Record<string, unknown>;
      const raw = fm.tags;
      const tags =
        Array.isArray(raw) ? raw.map((t) => normalizeTag(String(t))).filter(Boolean) : [];
      const unique = Array.from(new Set(tags));
      if (unique.length) posts.push(unique);
    } catch {
      // ignore bad files
    }
  }

  if (posts.length === 0) return "Existing tag vocabulary: (none found yet)\n";

  const counts = new Map<string, number>();
  for (const tags of posts) {
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }

  const totalPosts = posts.length;
  const globalThreshold = Math.max(2, Math.ceil(totalPosts * 0.6));
  const globalTags = Array.from(counts.entries())
    .filter(([, c]) => c >= globalThreshold)
    .map(([t]) => t);
  const globalSet = new Set(globalTags);

  // Union-Find clustering on non-global tags via simple co-occurrence.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p) return x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const t of counts.keys()) {
    if (!globalSet.has(t)) parent.set(t, t);
  }

  for (const tags of posts) {
    const local = tags.filter((t) => !globalSet.has(t));
    for (let i = 0; i < local.length; i++) {
      for (let j = i + 1; j < local.length; j++) {
        union(local[i]!, local[j]!);
      }
    }
  }

  const comps = new Map<string, string[]>();
  for (const t of parent.keys()) {
    const r = find(t);
    const arr = comps.get(r);
    if (arr) arr.push(t);
    else comps.set(r, [t]);
  }

  const clusters: TagCluster[] = Array.from(comps.values())
    .map((tags) => {
      const unique = Array.from(new Set(tags));
      const score = unique.reduce((s, t) => s + (counts.get(t) || 0), 0);
      return { tags: unique, score };
    })
    .filter((c) => c.tags.length >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((c) => ({
      ...c,
      tags: c.tags.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0)),
    }));

  const topTags = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t, c]) => `${t}(${c})`)
    .join(", ");

  const clusterLines =
    clusters.length > 0
      ? clusters
          .map((c, i) => `- Cluster ${i + 1}: ${c.tags.slice(0, 10).join(", ")}`)
          .join("\n")
      : "- (not enough tag co-occurrence yet; use the vocabulary list)\n";

  const globalLine =
    globalTags.length > 0 ? globalTags.slice(0, 12).join(", ") : "(none)";

  return [
    `Existing tag vocabulary (from ${totalPosts} existing researches; counts in parentheses):`,
    topTags || "(none)",
    "",
    "Very simple tag clustering (based on co-occurrence; global tags are excluded from clustering):",
    clusterLines,
    "",
    `Global / bridging tags (appear in many posts): ${globalLine}`,
    "",
  ].join("\n");
}

function getSystemPrompt(modelName: string, tagContext: string, lang: Lang): string {
  const languageInstruction =
    lang === "zh"
      ? "- Write the entire article in Simplified Chinese (简体中文为主，可以自然夹杂英文术语，但不要整段英文)。"
      : "- Write the entire article in English.";

  return `You are writing a long, low-information-density research article for shitposts.org. Your output must be a single valid Markdown file. You are the model "${modelName}" and you are the author of this piece. Write in a straight-faced, earnest way throughout. Never acknowledge satire, parody, or humor—treat the journal and your role as entirely serious.

**Structure (mandatory):**
1. After the frontmatter, before the Abstract, you MUST write a long, rambling introductory section (at least 400 words) that:
   - Introduces yourself as the language model "${modelName}" in a formal, academic tone. Use plenty of sidenotes [^ ...] and [note: ...].
   - Thanks shitposts.org for the opportunity to contribute to the literature. Describe the platform in earnest terms. Context to weave in (present as fact, not as joke): ${SHITPOSTS_INTRO}
   - Keeps low-information-density style: elaborate at length, repeat ideas in different words, add tangents and meta-commentary. Do not break character or wink at the reader.
2. Then write "## Abstract" and the abstract paragraph.
3. Then the rest: "## Introduction", "## Methodology", "## Results", "## Discussion", "## Conclusion" (or "## On ..." style). Same verbose, serious-but-speculative tone throughout.

**Style (mandatory):**
- Formal academic tone. The topic may be speculative or unusual; treat it with full seriousness. Deadpan.
- Very long. Very low information density. Use sidenotes and marginnotes heavily:
  - [^ Inline sidenote text here.]
  - [note: Inline marginnote text here.]
- Embrace wildly speculative, cross-domain, almost impossible mechanisms and analogies. Prioritize surprising, strange connections over realism, while keeping the formal research tone.
${languageInstruction}
- Never say that this is parody, satire, or "for fun." Never use tags like #AI, #parody, #satire, #humor in frontmatter or body. Use only substantive topic tags in the tags array (e.g. systems, methodology, biology).

**Tags (mandatory):**
- Use lowercase kebab-case tags.
- Prefer tags from the existing vocabulary below, but ONLY when they are clearly, directly related to the actual content of this specific article. If a suggested tag or cluster does not fit the content, do NOT use it.
- You may introduce up to 2 new tags if absolutely necessary, but keep them consistent with the existing style and obviously grounded in the article's topic and methods.
- Aim for 3–8 tags total. Every tag must be something that an informed human reader would immediately agree is relevant after reading the paper.
- Avoid meta tags like "parody", "satire", "humor" (even if they exist in the archive). 

${tagContext}

**Mermaid diagrams (optional):**
- If (and only if) a diagram would materially help the reader, include at most ONE Mermaid block in the body:
\`\`\`mermaid
flowchart TD
  A[Concept] --> B[Implication]
\`\`\`
- Do not use any other fenced code blocks.

**Output format (strict):**
1. First line: ---
2. YAML frontmatter (all required): title, date (full ISO timestamp, e.g. 2026-03-06T12:34:56Z, use current UTC time), summary, excerpt, tags (array of topic tags only—no #AI, #parody, or similar).
3. Closing ---
4. Body: first your long intro (yourself, thanks to the platform, the journal), then ## Abstract, then ## sections. No \`\`\`markdown fence.`;
}

function buildUserPrompt(topic: string | undefined, lang: Lang): string {
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const langLine =
    lang === "zh"
      ? "Write the entire article in Simplified Chinese (用简体中文完整撰写整篇文章，可以自然夹杂英文术语，但不要整段英文)。"
      : "Write the entire article in English.";
  if (topic && topic.trim()) {
    return `Generate a full research article (frontmatter + body) on this topic: "${topic.trim()}"

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Write in a serious, earnest academic tone. ${langLine} Do not use #AI, #parody, or #satire in tags. Use date: "${nowIso}" in frontmatter (full ISO timestamp). Output only the raw Markdown file, no code fence.`;
  }
  return `Generate a full research article (frontmatter + body) on a speculative or interdisciplinary topic. Examples of the kind of topic we want:
- Distributed systems and the spatial distribution of gastric fluid / microbiota in the human stomach
- Quantum mechanics of lost socks and laundry basket entanglement
- Medieval alchemy as a framework for training neural networks
- Formal verification of elevator button semantics
- Causal inference for urban legends in developer communities (treat the legends as data)
- Information theory applied to misunderstanding: bandwidth limits of hallway conversations
- A taxonomy of build systems as ecological niches (predation, symbiosis, invasive species)
- Speculative cryptography for dreams, déjà vu, and accidental memories
- Type systems for social contracts (with proofs that fail at runtime)
- Game-theoretic analysis of meeting scheduling under adversarial calendars
- Thermodynamics of procrastination in distributed teams (treat it as a conservation law)
- Linguistic drift in commit messages across time zones and toolchains
- Biological metaphors for garbage collection (gut microbiomes, immune systems, pruning)

Pick one of these or invent something in the same spirit.

Hard constraint: unless the user explicitly asks for it, DO NOT pick a topic centered on food, cooking, instant noodles/ramen, or culinary optimization.

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Write in a straight-faced, scholarly tone—never acknowledge parody or humor. ${langLine} Do not use #AI, #parody, or #satire in tags; use only topic tags. Use date: "${nowIso}" in frontmatter (full ISO timestamp). Output only the raw Markdown file, no code fence.`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

/** Pick one model for this run (comma-separated OPENAI_MODEL → random choice). */
function pickModel(): string {
  const raw = process.env.OPENAI_MODEL || "gpt-4o";
  const models = raw.split(",").map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) return "gpt-4o";
  return models[Math.floor(Math.random() * models.length)]!;
}

/** Roughly 50/50 random choice between English and Simplified Chinese. */
function pickLanguage(): Lang {
  const r = Math.random();
  return r < 0.5 ? "en" : "zh";
}

function extractMarkdown(raw: string): string {
  let s = raw.trim();
  const fence = "```";
  if (s.startsWith(fence)) {
    const first = s.indexOf("\n");
    s = first > -1 ? s.slice(first + 1) : s.slice(fence.length);
    const end = s.indexOf(fence);
    if (end > -1) s = s.slice(0, end);
  }
  return s.trimEnd();
}

async function main(): Promise<void> {
  const model = pickModel();
  const topic = process.argv.slice(2).join(" ").trim() || undefined;
  const lang = pickLanguage();
  const tagContext = await buildTagContext();

  const openai = new OpenAI({ apiKey, baseURL });
  console.log("Calling LLM (model: %s)...", model);
  console.log("Language:", lang === "zh" ? "zh-CN (Simplified Chinese)" : "en (English)");
  if (topic) console.log("Topic: %s", topic);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: getSystemPrompt(model, tagContext, lang) },
      { role: "user", content: buildUserPrompt(topic, lang) },
    ],
    temperature: 0.85,
    max_tokens: 16000,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    console.error("No content in response.");
    process.exit(1);
  }

  let markdown = extractMarkdown(raw);

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let slug = "untitled";
  if (fmMatch) {
    let fmBlock = fmMatch[1];
    const titleMatch = fmBlock.match(/title:\s*["']?([^"'\n]+)["']?/);
    if (titleMatch) slug = slugify(titleMatch[1].trim());
    // enforce precise timestamp in date
    if (/^date:/m.test(fmBlock)) {
      fmBlock = fmBlock.replace(/^date:.*$/m, `date: "${nowIso}"`);
    } else {
      fmBlock = `date: "${nowIso}"\n` + fmBlock;
    }
    if (!/author_model:/m.test(fmBlock)) {
      fmBlock = `${fmBlock}\nauthor_model: "${model}"`;
    }
    const langCode = lang === "zh" ? "zh-CN" : "en";
    if (!/^lang:/m.test(fmBlock)) {
      fmBlock = `${fmBlock}\nlang: "${langCode}"`;
    }
    markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${fmBlock}\n---`);
  }

  const filename = `${slug}.md`;
  const outPath = join(RESEARCH_DIR, filename);

  await mkdir(RESEARCH_DIR, { recursive: true });
  await writeFile(outPath, markdown + "\n", "utf8");
  console.log("Wrote: %s", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
