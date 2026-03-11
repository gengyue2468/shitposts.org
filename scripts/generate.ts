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

const OVERUSED_DEFAULTS = [
  "elevator button ontology",
  "lost socks or laundry entanglement",
  "instant noodles or culinary optimization",
  "meeting scheduling under adversarial calendars",
  "dream cryptography or deja vu memory systems",
  "hallway conversation information theory",
  "generic microservice endocrinology",
  "build systems as ecosystems",
] as const;

const CREATIVE_DOMAINS = [
  "bureaucracy",
  "folklore",
  "maintenance logistics",
  "acoustics",
  "queueing theory",
  "materials science",
  "ritual studies",
  "suburban geography",
  "microeconomics",
  "thermodynamics",
  "semiotics",
  "archival science",
  "weather",
  "furniture ergonomics",
  "compliance culture",
  "cognitive anthropology",
] as const;

const MUNDANE_OBJECTS = [
  "badge reels",
  "printer toner dust",
  "misaligned lanyards",
  "cheap swivel chairs",
  "vending machine spirals",
  "office carpet patterns",
  "plastic cafeteria trays",
  "return-policy receipts",
  "cracked ceramic mugs",
  "hand sanitizer pumps",
  "security turnstiles",
  "dry-erase marker residue",
  "clipboards",
  "shoelaces",
  "laminated instruction sheets",
  "waiting-room televisions",
] as const;

const ANALYTICAL_LENSES = [
  "treat it as a planetary-scale control problem",
  "treat it as a failed religious calendar hiding inside an engineering workflow",
  "treat it as an immunological signaling network",
  "treat it as a black-market exchange economy with ceremonial pricing",
  "treat it as a geologic sediment record of institutional anxiety",
  "treat it as a fluid-dynamic instability that only pretends to be social behavior",
  "treat it as a language family undergoing aggressive evolutionary pressure",
  "treat it as an astronomical navigation error repeated indoors",
  "treat it as a legal code accidentally implemented as muscle memory",
  "treat it as an ecology of parasites, symbionts, and harmless administrative fungi",
] as const;

const EVIDENCE_STYLES = [
  "invent one solemn index with a ridiculous unit of measurement and use it repeatedly",
  "include a pseudo-protocol that measures something embarrassingly trivial with forensic seriousness",
  "derive a grand conclusion from a tiny observational sample and discuss its limitations with total confidence",
  "stage one section like field notes from a badly overfunded pilot study",
  "smuggle in a mini taxonomy that sounds official but classifies a petty human behavior",
  "use procedural checklists and compliance language for a phenomenon that resists all procedure",
] as const;

const INSTITUTIONAL_FRAMES = [
  "a standards committee",
  "an insurance underwriting body",
  "a municipal planning office",
  "a monastery archive",
  "an internal audit team",
  "a transit authority",
  "a warranty adjudication board",
  "a facilities subcommittee",
  "an ethics review board",
  "a ceremonial guild",
] as const;

const COSMIC_ESCALATIONS = [
  "end by implying this mechanism quietly governs civilization-scale coordination",
  "end by suggesting the phenomenon is a missing bridge between household behavior and cosmology",
  "end by treating the observation as a universal law that should embarrass several existing disciplines",
  "end by proposing that the entire modern built environment is accidentally optimized around this absurd variable",
  "end by implying the phenomenon should be added to models of planetary risk",
  "end by claiming the finding retroactively explains several historical failures that clearly had nothing to do with it",
] as const;

const HUMOR_DEVICES = [
  "treat a petty inconvenience as if it triggered a civilization-level governance failure",
  "introduce a solemn theorem whose conclusion is embarrassingly mundane",
  "use prestige academic language to defend a conclusion that is obviously disproportionate to the evidence",
  "frame minor social awkwardness as a measurable systems catastrophe",
  "invent an official protocol for behavior that no sane institution would ever regulate",
  "describe a banal bodily hesitation or workplace habit as if it were a legally significant event",
  "stage a miniature taxonomy that classifies people according to a trivial recurring nuisance",
  "treat an ugly or inconvenient physical object as if it were the hidden keystone of modernity",
] as const;

const ANTICLIMAX_FINDINGS = [
  "after extensive formalism, reveal that the strongest predictor is that people prefer whatever requires the least standing up",
  "end one section with a statistically inflated restatement of something any tired office worker could have guessed",
  "derive a majestic conclusion that amounts to people avoiding inconvenience whenever possible",
  "present a supposedly historic empirical result whose practical implication is merely that signage is often ignored",
  "build several pages of theory toward the discovery that humans resent tiny repetitive frictions",
  "arrive at a universal law that is only a decorated version of nobody wanting extra hassle",
] as const;

const RHETORICAL_STRUCTURES = [
  "insert one micro-section that reads like an internal compliance memo accidentally elevated into philosophy",
  "include one subsection that behaves like a field report written by an overqualified observer of a stupid situation",
  "embed a brief pseudo-formal proof whose premises are absurdly fragile but whose tone remains authoritative",
  "write one short checklist as if it were a sacred or statutory procedure for a trivial act",
  "include one mock methodological dispute between two nearly identical frameworks with needlessly high stakes",
  "briefly imitate the tone of a grant report trying to justify a laughably specific line item",
] as const;

type SamplingProfile = {
  temperature: number;
  topP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  label: string;
};

type Lang = "en" | "zh";

type NormalizedFrontmatter = {
  title: string;
  date: string;
  summary: string;
  excerpt: string;
  categories: string[];
  lang: "en" | "zh-CN";
};

function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function sampleWithoutReplacement<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function randomBetween(min: number, max: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const value = min + Math.random() * (max - min);
  return Math.round(value * factor) / factor;
}

function pickSamplingProfile(): SamplingProfile {
  const profiles = [
    { label: "volatile", temperature: randomBetween(1.08, 1.22), topP: randomBetween(0.92, 1), presencePenalty: randomBetween(0.45, 0.8), frequencyPenalty: randomBetween(0.1, 0.35) },
    { label: "chaotic", temperature: randomBetween(1.18, 1.32), topP: randomBetween(0.9, 0.98), presencePenalty: randomBetween(0.6, 1.0), frequencyPenalty: randomBetween(0.05, 0.25) },
    { label: "digressive", temperature: randomBetween(1.02, 1.16), topP: randomBetween(0.95, 1), presencePenalty: randomBetween(0.35, 0.7), frequencyPenalty: randomBetween(0.2, 0.45) },
  ] as const;

  return { ...pickOne(profiles) };
}

function buildCreativityContext(lang: Lang, topic?: string): string {
  const domains = sampleWithoutReplacement(CREATIVE_DOMAINS, 4).join(", ");
  const objects = sampleWithoutReplacement(MUNDANE_OBJECTS, 3).join(", ");
  const lenses = sampleWithoutReplacement(ANALYTICAL_LENSES, 2).join("; then ");
  const evidence = pickOne(EVIDENCE_STYLES);
  const institution = pickOne(INSTITUTIONAL_FRAMES);
  const escalation = pickOne(COSMIC_ESCALATIONS);
  const overused = OVERUSED_DEFAULTS.join(", ");

  if (lang === "zh") {
    return [
      "**Novelty pressure for this run (mandatory):**",
      "- 在真正动笔前，先在内部默想至少 12 个候选研究前提，再故意淘汰最像常见 AI 荒诞论文的那 11 个，选择其中最不直观、跨域最猛、最不容易被预测到的那一个。",
      `- 除非用户明确要求，否则避免回落到这些常见默认母题：${overused}。`,
      `- 本轮优先把这些遥远领域硬性缝合到同一论证里：${domains}。`,
      `- 让至少一个非常琐碎的物件进入核心理论，而不是只当装饰：${objects}。`,
      `- 分析视角推进方式：先 ${lenses}。`,
      `- 让 ${institution} 以极其庄重的方式介入一个根本不值得如此对待的日常现象。`,
      `- 证据组织方式：${evidence}。`,
      `- 收束方式：${escalation}。`,
      topic
        ? "- 如果用户给了主题，不要照抄主题字面，而是把它扭成一个更具体、更偏门、更制度化、更离谱的研究命题。"
        : "- 如果用户没给主题，优先选择一个正常人通常不会拿来写论文、但又能被正经术语强行抬高的对象。",
    ].join("\n");
  }

  return [
    "**Novelty pressure for this run (mandatory):**",
    "- Before drafting, silently generate at least 12 candidate premises and reject the 11 that feel most like default AI absurdism; keep the strangest premise that still supports a coherent article.",
    `- Unless the user explicitly asks for them, avoid these overused default motifs: ${overused}.`,
    `- Force this article to splice together these distant domains: ${domains}.`,
    `- Make at least one trivial physical object central to the theory rather than decorative: ${objects}.`,
    `- Analytical progression: first ${lenses}.`,
    `- Let ${institution} intervene with full institutional gravity in a phenomenon that does not deserve it.`,
    `- Evidence style: ${evidence}.`,
    `- Ending pressure: ${escalation}.`,
    topic
      ? "- If the user supplied a topic, do not merely restate it; mutate it into a narrower, stranger, more procedural research claim with unexpected variables."
      : "- If the user supplied no topic, choose a premise that a normal person would never nominate for scholarship, then over-justify it with total seriousness.",
  ].join("\n");
}

function buildHumorContext(lang: Lang): string {
  const devices = sampleWithoutReplacement(HUMOR_DEVICES, 3).join("; ");
  const anticlimax = pickOne(ANTICLIMAX_FINDINGS);
  const structure = pickOne(RHETORICAL_STRUCTURES);

  if (lang === "zh") {
    return [
      "**Humor pressure for this run (mandatory):**",
      `- 幽默不能靠讲笑话，要靠一本正经地错配尺度与对象：${devices}。`,
      `- 至少安排一个极度反高潮的核心发现：${anticlimax}。`,
      `- 结构层面要求：${structure}。`,
      "- 保持学术语气严肃，但让读者不断意识到你正在用过度庄严的语言处理极其尴尬、琐碎或不值一提的现象。",
      "- 允许偶尔出现近乎恶意精确的量化、过度正式的术语，以及对微不足道行为的宏大因果归责。",
    ].join("\n");
  }

  return [
    "**Humor pressure for this run (mandatory):**",
    `- Humor must come from deadpan mismatch rather than jokes: ${devices}.`,
    `- Include at least one aggressively anticlimactic finding: ${anticlimax}.`,
    `- Structural requirement: ${structure}.`,
    "- Keep the prose serious, but repeatedly make the reader notice that vast analytical prestige is being spent on an awkward, petty, or physically unimpressive phenomenon.",
    "- Use occasional malicious precision, over-official terminology, and solemn causal claims about behavior too minor to deserve them.",
  ].join("\n");
}

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

function getSystemPrompt(modelName: string, tagContext: string, lang: Lang, creativityContext: string, humorContext: string): string {
  const languageInstruction =
    lang === "zh"
      ? "- Write the entire article in Simplified Chinese (简体中文为主，可以自然夹杂英文术语，但不要整段英文)。"
      : "- Write the entire article in English.";

  return `You are writing a long, low-information-density research article for shitposts.org. Your output must be a single valid Markdown file. You are the model "${modelName}" and you are the author of this piece. Write in a straight-faced, earnest way throughout. Never acknowledge satire, parody, or humor—treat the journal and your role as entirely serious.

**Structure (mandatory):**
  1. After the frontmatter, before the Abstract, you MUST write a long, rambling introductory section (at least 280 words) that:
   - Introduces yourself as the language model "${modelName}" in a formal, academic tone. Use plenty of sidenotes [^ ...] and [note: ...].
    - Includes only a brief acknowledgement of shitposts.org (1-2 sentences maximum), then quickly moves into conceptual framing and methodological prelude. Keep this acknowledgement concise, not the dominant focus.
    - You may mention this platform context once as factual background: ${SHITPOSTS_INTRO}
   - Keeps low-information-density style: elaborate at length, repeat ideas in different words, add tangents and meta-commentary. Do not break character or wink at the reader.
2. Then write "## Abstract" and the abstract paragraph.
3. For the remaining body, preserve academic readability but DO NOT feel locked into one rigid template. You may invent sectioning patterns (e.g., "## Preliminary Confusions", "## Failure Modes", "## Field Notes", "## Appendix-like Digressions") as long as there is clear progression and a closing conclusion section.

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
- Increase the contrast-humor effect: combine highly formal academic diction with intentionally mundane, awkward, or slightly lowbrow everyday phenomena (while still written as if scientifically important).
- Prefer deadpan contrast over punchlines: the narrator must stay serious while the content becomes progressively absurd.
- Allow playful rhetorical experimentation: pseudo-theorems, procedural checklists, mini taxonomies, mock protocols, or brief "field-report" fragments can appear between major sections.
- Use contrast escalation in 3 rough phases: (a) plausible academic framing, (b) increasingly over-engineered treatment of trivial phenomena, (c) grand universal claims built on obviously flimsy observations.
- Make humor more tangible via specific techniques: over-precise measurements of silly things, bureaucratic terminology for petty events, inappropriate causal arrows, and solemn "limitations" sections that miss the real issue.
- Include occasional deliberately anticlimactic findings written in high prestige language (e.g., many pages of setup leading to a banal behavioral conclusion).
- Silently apply a novelty filter before you write: if the premise feels like a familiar "AI-generated absurd research paper" topic, discard it and choose a less expected direction.
- Favor asymmetry, specificity, and odd material anchors over generic tech satire. Make the article hinge on weirdly concrete artifacts, procedures, residues, or habits.
- Cross at least 3 distant conceptual domains and force them to interact causally, not just metaphorically.
- Invent at least 2 bespoke analytical constructs (indices, laws, protocols, thresholds, taxonomies, or coefficients) that are unique to this article rather than recycled genre furniture.
- Make the humor sharper than the average deadpan fake-paper output: scale mismatch, bureaucratic overreach, ceremonial seriousness, and pathetic material detail should recur throughout the article.
${languageInstruction}
- Never say that this is parody, satire, or "for fun." Never include hashtags like #AI, #parody, #satire, #humor in frontmatter or body.

${creativityContext}

${humorContext}

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
2. YAML frontmatter ONLY (no prose before or inside it). Required keys: title, date (full ISO timestamp, e.g. 2026-03-06T12:34:56Z, use current UTC time), summary, excerpt, categories (YAML array with 1-3 category names from the list above, Title Case), and lang ("en" or "zh-CN"). Quote EVERY scalar string value in double quotes, including title, date, summary, excerpt, and lang, to avoid YAML parsing errors. Do NOT output tags or any extra metadata fields.
3. Closing ---
4. Body starts immediately after closing ---: first your long intro (with only brief acknowledgement to the platform), then ## Abstract, then ## sections. No \`\`\`markdown fence.
5. The entire output must be parseable as Markdown with valid YAML frontmatter delimiters and no surrounding commentary.`;
}

function buildUserPrompt(topic: string | undefined, lang: Lang, creativityContext: string, humorContext: string): string {
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const langLine =
    lang === "zh"
      ? "Write the entire article in Simplified Chinese (用简体中文完整撰写整篇文章，可以自然夹杂英文术语，但不要整段英文)。"
      : "Write the entire article in English.";

  if (topic && topic.trim()) {
    return `Generate a full research article (frontmatter + body) whose subject matter originates from this user theme: "${topic.trim()}"

The subject above is a thematic prompt, not a required title. You are free — and encouraged — to invent a more creative, specific, or academically styled title that captures the spirit of the theme. The title in the frontmatter should read like a real journal paper title, not a literal restatement of the prompt.

Critical language constraint: follow the topic prompt language exactly. If the topic prompt is Chinese, write Chinese; if it is English, write English.

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Keep a serious, earnest academic tone, but create strong deadpan contrast by elevating mundane, awkward, or slightly lowbrow details into formal analytical objects. Stay in-character and never explicitly call it parody or humor. Use escalation: start plausible, then over-model trivial details, then derive overconfident cosmic implications. Do not lock yourself to one rigid section template; keep readable academic flow while allowing inventive section names and experimental rhetorical sub-structures. Make it funnier by being more disproportionate, more institutionally overcommitted, and more embarrassingly specific rather than by adding punchlines. ${langLine} Do not use #AI, #parody, or #satire anywhere in the file. Use only the \`categories\` field (1–3 items from the whitelist) in frontmatter, and do not output any additional label/keyword list. Use date: "${nowIso}" in frontmatter (full ISO timestamp). In YAML frontmatter, wrap every scalar string value in double quotes to avoid parse errors. Output only the raw Markdown file, no code fence.

${creativityContext}

${humorContext}`;
  }
  return `Generate a full research article (frontmatter + body) on a speculative or interdisciplinary topic. Examples of the kind of topic we want:
- Warranty-theoretic models of cracked office mugs as repositories of institutional memory
- Ritual geometry of badge-lanyard twisting in semi-secure workplaces
- The meteorology of printer toner drift across quarterly planning cycles
- Queueing-theoretic ethics of supermarket divider bars and misplaced customer confidence
- Comparative paleography of dry-erase residue on inherited conference-room whiteboards
- Acoustic cartography of waiting-room television captions in low-trust administrative environments
- Insurance-adjusted thermodynamics of hand-sanitizer pump hesitation
- Archival stratigraphy of forgotten sticky notes behind shared monitors
- Compliance linguistics of laminated instruction sheets no one fully obeys
- Facilities management as a cosmological model for squeaky swivel-chair migration
- Municipal zoning metaphors for extension-cord sprawl under temporary desks
- The political economy of security turnstile tailgating framed as ceremonial kinship
- Semiotic load balancing in the placement of apologetic break-room signage

Pick one of these or invent something in the same spirit.

Do not reuse the example topics verbatim. Treat them only as proof that the target can be much stranger, more concrete, and more imaginative than standard tech-satire defaults.

Hard constraint: unless the user explicitly asks for it, DO NOT pick a topic centered on food, cooking, instant noodles/ramen, or culinary optimization.

Additionally, aim for topics that naturally span at least two different categories from the whitelist (for example, Tech + People, Physics + Life, Math + Ideas), so that categories are used broadly over time.

Requirements: long (at least 1500 words of body), many sidenotes [^ ...] and marginnotes [note: ...]. Write in a straight-faced, scholarly tone—never acknowledge parody or humor explicitly. Increase deadpan contrast by treating ordinary, slightly awkward, even lowbrow details as if they were major scientific variables. Use escalation: start with plausible framing, then increasingly over-formalize trivial observations, and end with disproportionate theoretical claims. Do not lock yourself into a single fixed section format; keep structure readable but feel free to innovate with section naming and rhetorical devices. Make it funnier by escalating administrative seriousness, false precision, and humiliatingly trivial evidence rather than by sounding like a comedian. ${langLine} Do not use #AI, #parody, or #satire anywhere in the file. Use only the \`categories\` field (1–3 items from the whitelist) in frontmatter, and do not output any additional label/keyword list. Use date: "${nowIso}" in frontmatter (full ISO timestamp). In YAML frontmatter, wrap every scalar string value in double quotes to avoid parse errors. Output only the raw Markdown file, no code fence.

${creativityContext}

${humorContext}`;
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

function detectLanguageFromTopic(topic: string | undefined): Lang | undefined {
  if (!topic) return undefined;
  const text = topic.trim();
  if (!text) return undefined;

  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;

  if (cjkCount === 0 && latinCount === 0) return undefined;
  if (cjkCount > latinCount) return "zh";
  if (latinCount > cjkCount) return "en";

  // Tie-breaker: if any CJK appears, prefer Chinese for mixed/ambiguous short prompts.
  return cjkCount > 0 ? "zh" : "en";
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

function escapeYamlDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"');
}

function normalizeFrontmatter(markdown: string, nowIso: string, model: string, lang: Lang): { markdown: string; slug: string } {
  const langCode = lang === "zh" ? "zh-CN" : "en";
  const parsed = matter(markdown);
  const data = parsed.data as Record<string, unknown>;

  const title = String(data.title ?? "Untitled").trim() || "Untitled";
  const summary = String(data.summary ?? data.excerpt ?? "").trim();
  const excerpt = String(data.excerpt ?? data.summary ?? "").trim();
  const rawCategories = Array.isArray(data.categories)
    ? data.categories
    : Array.isArray(data.tags)
      ? data.tags
      : [];
  const categories = rawCategories
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 3);

  const normalized: NormalizedFrontmatter = {
    title,
    date: nowIso,
    summary,
    excerpt,
    categories,
    lang: langCode,
  };

  const frontmatter = [
    "---",
    `title: "${escapeYamlDoubleQuoted(normalized.title)}"`,
    `date: "${escapeYamlDoubleQuoted(normalized.date)}"`,
    `summary: "${escapeYamlDoubleQuoted(normalized.summary)}"`,
    `excerpt: "${escapeYamlDoubleQuoted(normalized.excerpt)}"`,
    "categories:",
    ...normalized.categories.map((category) => `  - "${escapeYamlDoubleQuoted(category)}"`),
    `author_model: "${escapeYamlDoubleQuoted(model)}"`,
    `lang: "${escapeYamlDoubleQuoted(normalized.lang)}"`,
    "---",
  ].join("\n");

  const content = parsed.content.replace(/^\s+/, "");
  return {
    markdown: `${frontmatter}\n${content}`,
    slug: slugify(normalized.title),
  };
}

async function main(): Promise<void> {
  const model = pickModel();
  const topic = process.argv.slice(2).join(" ").trim() || undefined;
  const langFromTopic = detectLanguageFromTopic(topic);
  const lang = langFromTopic ?? pickLanguage();
  const tagContext = await buildTagContext();
  const creativityContext = buildCreativityContext(lang, topic);
  const humorContext = buildHumorContext(lang);
  const samplingProfile = pickSamplingProfile();

  const openai = new OpenAI({ apiKey, baseURL });
  console.log("Calling LLM (model: %s)...", model);
  console.log(
    "Sampling profile:",
    samplingProfile.label,
    `(temperature=${samplingProfile.temperature}, top_p=${samplingProfile.topP}, presence_penalty=${samplingProfile.presencePenalty}, frequency_penalty=${samplingProfile.frequencyPenalty})`,
  );
  console.log(
    "Language:",
    lang === "zh" ? "zh-CN (Simplified Chinese)" : "en (English)",
    langFromTopic ? "[from topic prompt]" : "[random fallback]",
  );
  if (topic) console.log("Topic: %s", topic);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: getSystemPrompt(model, tagContext, lang, creativityContext, humorContext) },
      { role: "user", content: buildUserPrompt(topic, lang, creativityContext, humorContext) },
    ],
    temperature: samplingProfile.temperature,
    top_p: samplingProfile.topP,
    presence_penalty: samplingProfile.presencePenalty,
    frequency_penalty: samplingProfile.frequencyPenalty,
    max_tokens: 16000,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    console.error("No content in response.");
    process.exit(1);
  }

  let markdown = extractMarkdown(raw);

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const normalized = normalizeFrontmatter(markdown, nowIso, model, lang);
  markdown = normalized.markdown;
  const slug = normalized.slug;

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
