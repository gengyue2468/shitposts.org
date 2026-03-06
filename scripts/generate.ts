#!/usr/bin/env bun

import OpenAI from "openai";
import { join } from "path";
import { writeFile, mkdir, readFile, readdir } from "fs/promises";
import matter from "gray-matter";
import config from "../src/config.js";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || undefined;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY. Copy .env.example to .env and set it.");
  process.exit(1);
}

const RESEARCH_DIR = join(process.cwd(), "src", "content", "research");

const SHITPOSTS_INTRO = `shitposts.org is an open-access, interdisciplinary research journal that welcomes speculative and non-traditional contributions. The venue provides publication opportunities for a variety of authors and encourages rigorous but exploratory work across domains.`;

type Lang = "en" | "zh";

async function buildTagContext(): Promise<string> {
  const whitelist: string[] = config.research?.categoryWhitelist ?? [
    "Tech", "Physics", "Life", "Earth", "Space", "Chemistry", "Engineering",
    "Math", "Methods", "Systems", "Health", "Medicine",
    "People", "Society", "Culture", "Arts", "History", "Language",
    "Philosophy", "Psychology", "Economics", "Law", "Politics",
    "Ideas", "Environment",
  ];

  let files: string[] = [];
  try {
    files = (await readdir(RESEARCH_DIR)).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    // no posts yet — show all categories at 0
  }

  const counts = new Map<string, number>(whitelist.map((c) => [c, 0]));
  let totalPosts = 0;

  for (const f of files) {
    try {
      const content = await readFile(join(RESEARCH_DIR, f), "utf8");
      const fm = matter(content).data as Record<string, unknown>;
      const raw = fm.categories ?? fm.tags;
      const tags =
        Array.isArray(raw)
          ? raw.map((t) => String(t).trim()).filter(Boolean)
          : [];
      const matched = tags.filter((t) => counts.has(t));
      if (matched.length) {
        totalPosts++;
        for (const t of matched) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    } catch {
      // ignore bad files
    }
  }

  // Sort ascending by count so under-represented categories appear first
  const rows = Array.from(counts.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([t, c]) => `${t}(${c})`)
    .join(", ");

  return [
    `Category usage across ${totalPosts} existing articles (counts in parentheses, sorted least-used first — prefer categories with lower counts):`,
    rows,
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
- Very long. Very low information density. Use sidenotes and marginnotes heavily, following **exactly** these forms:
  - Inline sidenotes: \`[^\u0020Sidenote text here.]\` — one space after \`[^\`, then the full note content, all on one line, and then a single closing \`]\`.
  - Inline marginnotes: \`[note:\u0020Marginnote text here.]\` — the literal prefix \`[note:\u0020\` followed by the full note content, then a single closing \`]\`.
  - Do **not** use reference-style footnotes such as \`[^1]: ...\` or multi-line note definitions.
  - Do **not** nest additional \`[\` or \`]\` characters inside a single note; keep each note self-contained and relatively short.
  - Never emit empty notes like \`[^]\` or \`[note:]\`; every note must contain meaningful text.
- Embrace wildly speculative, cross-domain, almost impossible mechanisms and analogies. Prioritize surprising, strange connections over realism, while keeping the formal research tone.
- Push yourself toward even more \"天马行空\" (wildly imaginative) constructions than typical academic satire: cross as many conceptual boundaries as possible while remaining internally consistent.
${languageInstruction}
- Never say that this is parody, satire, or "for fun." Never include hashtags like #AI, #parody, #satire, #humor in frontmatter or body.

**Categories (mandatory):**
- Assign each article to 1–3 broad, journal-style sections. You MUST choose from the following fixed vocabulary only (Title Case, do NOT invent new category names):
${(config.research?.categoryWhitelist ?? ["Tech", "Physics", "Life", "Earth", "People", "Math", "Methods", "Ideas", "Society", "Culture", "Systems", "Health", "Arts"]).map((c) => `  - ${c}`).join("\n")}
- Use these names exactly as written above (Title Case).
- Only assign a category when it clearly matches the article’s actual content. If none fits perfectly, choose the closest one, but NEVER output a category name that is not in the list.
- Every chosen category must be something that an informed human reader would immediately agree is relevant after reading the paper.
- Use the archive summary below to understand which categories already appear frequently.
- When multiple categories are plausible, prefer those that are currently under-represented in the archive so that, over many articles, usage of all categories becomes more balanced ("雨露均沾").

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
2. YAML frontmatter (all required): title, date (full ISO timestamp, e.g. 2026-03-06T12:34:56Z, use current UTC time), summary, excerpt, categories (array of 1–3 category names from the list above, Title Case), and lang ("en" or "zh-CN"). Do NOT output a tags field.
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
    return `Generate a full research article (frontmatter + body) whose subject matter is: "${topic.trim()}"

The subject above is a thematic prompt, not a required title. You are free — and encouraged — to invent a more creative, specific, or academically styled title that captures the spirit of the theme. The title in the frontmatter should read like a real journal paper title, not a literal restatement of the prompt.

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Write in a serious, earnest academic tone. ${langLine} Do not use #AI, #parody, or #satire anywhere in the file. Use only the \`categories\` field (1–3 items from the whitelist) in frontmatter, and do not output any additional label/keyword list. Use date: "${nowIso}" in frontmatter (full ISO timestamp). Output only the raw Markdown file, no code fence.`;
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

Additionally, aim for topics that naturally span at least two different categories from the whitelist (for example, Tech + People, Physics + Life, Math + Ideas), so that categories are used broadly over time.

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Write in a straight-faced, scholarly tone—never acknowledge parody or humor. ${langLine} Do not use #AI, #parody, or #satire anywhere in the file. Use only the \`categories\` field (1–3 items from the whitelist) in frontmatter, and do not output any additional label/keyword list. Use date: "${nowIso}" in frontmatter (full ISO timestamp). Output only the raw Markdown file, no code fence.`;
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
    temperature: 0.9,
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
