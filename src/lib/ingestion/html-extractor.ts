import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import OpenAI from "openai";
import { HTML_INGESTION_CONFIG } from "@/lib/config";

const MIN_IMAGE_DIM = 150;
const DECORATIVE_ALT_MAX_LEN = 10;
const IMAGE_MARKDOWN_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

function resolveUrl(baseUrl: string, href: string): string {
  if (!href || href.startsWith("data:")) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

export type FetchAndExtractResult = {
  title: string;
  html: string;
};

const DEFAULT_JS_TIMEOUT = 30_000;

const STANDARD_HTML_TAGS = new Set([
  "a","abbr","address","area","article","aside","audio","b","base","bdi","bdo",
  "blockquote","body","br","button","canvas","caption","cite","code","col",
  "colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl",
  "dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2",
  "h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img",
  "input","ins","kbd","label","legend","li","link","main","map","mark","menu",
  "meta","meter","nav","noscript","object","ol","optgroup","option","output","p",
  "param","picture","pre","progress","q","rp","rt","ruby","s","samp","script",
  "search","section","select","slot","small","source","span","strong","style",
  "sub","summary","sup","table","tbody","td","template","textarea","tfoot","th",
  "thead","time","title","tr","track","u","ul","var","video","wbr",
]);

/**
 * Validates that a CSS selector looks correct. Bare words that aren't standard
 * HTML tag names are almost certainly a mistake (missing . or # prefix).
 */
function validateCssSelector(sel: string): void {
  const bare = sel.match(/^[a-zA-Z][\w-]*$/);
  if (bare && !STANDARD_HTML_TAGS.has(sel.toLowerCase())) {
    throw new Error(
      `CSS selector "${sel}" looks like a bare word but is not a standard HTML tag. ` +
      `Did you mean ".${sel}" (class) or "#${sel}" (ID)? ` +
      `CSS selectors must start with "." for classes, "#" for IDs, or be a valid HTML tag name.`
    );
  }
}

/**
 * Fetch fully-rendered HTML using Playwright (headless Chromium). Use when the page loads content via JavaScript.
 */
async function fetchHtmlWithBrowser(
  url: string,
  cssSelector?: string,
  timeout: number = HTML_INGESTION_CONFIG.jsRenderTimeout ?? DEFAULT_JS_TIMEOUT
): Promise<FetchAndExtractResult> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout,
    });
    const title =
      (await page.title())?.trim() || new URL(url).hostname;

    if (cssSelector?.trim()) {
      const sel = cssSelector.trim();
      validateCssSelector(sel);
      await page.waitForSelector(sel, { timeout });
      const contentHtml = await page.locator(sel).first().evaluate((el) => el.innerHTML);
      return { title, html: contentHtml };
    }

    const fullHtml = await page.content();
    const dom = new JSDOM(fullHtml, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.content)
      throw new Error("Readability could not extract article content from JS-rendered page");
    return {
      title: article.title?.trim() || title,
      html: article.content,
    };
  } finally {
    await browser.close();
  }
}

function isMissingPlaywrightBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers") ||
    message.includes("npx playwright install")
  );
}

async function fetchHtmlWithoutBrowser(
  url: string,
  cssSelector?: string,
): Promise<FetchAndExtractResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RAGIngest/1.0; +https://github.com/ai-rag-saas)",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  let contentHtml: string;
  let title: string;

  if (cssSelector?.trim()) {
    validateCssSelector(cssSelector.trim());
    const el = document.querySelector(cssSelector.trim());
    if (!el) {
      const reader = new Readability(document);
      const article = reader.parse();
      if (article?.content) {
        contentHtml = article.content;
        title = article.title?.trim() ?? new URL(url).hostname;
      } else {
        throw new Error(
          `Selector "${cssSelector}" matched no element. The URL importer fetches raw HTML and does not run JavaScript, so elements that are added by client-side code (e.g. React/Vue) will not be present. Try leaving the selector empty to use automatic extraction, or use a selector that exists in the initial HTML.`
        );
      }
    } else {
      contentHtml = el.innerHTML;
      title =
        document.querySelector("title")?.textContent?.trim() ?? new URL(url).hostname;
    }
  } else {
    const reader = new Readability(document);
    const article = reader.parse();
    if (!article?.content)
      throw new Error("Readability could not extract article content");
    contentHtml = article.content;
    title = article.title?.trim() ?? new URL(url).hostname;
  }

  return { title, html: contentHtml };
}

/**
 * Fetch HTML from URL and extract main content using Readability or an optional CSS selector.
 * When renderJs is true, uses Playwright to render the page before extraction.
 */
export async function fetchAndExtractHtml(
  url: string,
  cssSelector?: string,
  renderJs: boolean = false
): Promise<FetchAndExtractResult> {
  if (renderJs) {
    try {
      return await fetchHtmlWithBrowser(url, cssSelector);
    } catch (err) {
      if (!isMissingPlaywrightBrowserError(err)) throw err;
      // Fall back to non-JS extraction when Playwright browsers are not installed.
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          "[ingest] Playwright browser executable not found; falling back to non-JS URL extraction."
        );
      }
      return fetchHtmlWithoutBrowser(url, cssSelector);
    }
  }
  return fetchHtmlWithoutBrowser(url, cssSelector);
}

export type ImageCandidate = {
  url: string;
  alt: string;
  inFigureWithCaption: boolean;
  substantiveAlt: boolean;
};

/**
 * Apply heuristic filtering to images in the content HTML; returns candidates for vision classification.
 */
export function classifyImages(
  contentHtml: string,
  baseUrl: string
): ImageCandidate[] {
  const dom = new JSDOM(contentHtml);
  const doc = dom.window.document;
  const imgs = doc.querySelectorAll("img");
  const minDim = HTML_INGESTION_CONFIG.minImageDimension ?? MIN_IMAGE_DIM;
  const candidates: ImageCandidate[] = [];

  for (const img of imgs) {
    const role = img.getAttribute("role");
    const ariaHidden = img.getAttribute("aria-hidden");
    if (role === "presentation" || ariaHidden === "true") continue;

    const alt = (img.getAttribute("alt") ?? "").trim();
    if (alt === "" && !img.closest("figure")) continue;

    const width = img.getAttribute("width");
    const height = img.getAttribute("height");
    if (width && height) {
      const w = parseInt(width, 10);
      const h = parseInt(height, 10);
      if ((!isNaN(w) && w < minDim) || (!isNaN(h) && h < minDim)) continue;
    }

    let src = (img.getAttribute("src") ?? "").trim();
    if (!src) continue;
    if (src.startsWith("data:")) {
      if (src.startsWith("data:image/svg+xml")) continue;
      const dataMatch = src.match(/^data:image\/[^;]+;base64,[A-Za-z0-9+/=]+$/);
      if (dataMatch && src.length < 200) continue;
    }
    if (src.includes("1x1") || src.includes("spacer") || src.endsWith(".gif"))
      continue;

    const resolved = resolveUrl(baseUrl, src);
    if (!resolved.startsWith("http")) continue;

    const figure = img.closest("figure");
    const hasFigCaption = figure?.querySelector("figcaption");
    const inFigureWithCaption = Boolean(hasFigCaption);
    const substantiveAlt = alt.length > DECORATIVE_ALT_MAX_LEN;

    candidates.push({
      url: resolved,
      alt,
      inFigureWithCaption,
      substantiveAlt,
    });
  }

  return candidates;
}

/**
 * Filter candidates: keep those with strong signal (figure+figcaption or substantive alt);
 * for the rest, cap at maxImages and return for vision classification.
 */
export function selectImagesForVision(
  candidates: ImageCandidate[]
): ImageCandidate[] {
  const max = HTML_INGESTION_CONFIG.maxImages ?? 10;
  const keep: ImageCandidate[] = [];
  const ambiguous: ImageCandidate[] = [];

  for (const c of candidates) {
    if (c.inFigureWithCaption || c.substantiveAlt) {
      keep.push(c);
    } else {
      ambiguous.push(c);
    }
  }

  const fromAmbiguous = ambiguous.slice(0, Math.max(0, max - keep.length));
  return [...keep, ...fromAmbiguous].slice(0, max);
}

const VISION_PROMPT = `Is this image informational (diagram, chart, table, technical illustration, screenshot) or decorative (stock photo, logo, decorative graphic)? If informational, describe its content in detail in one paragraph. If decorative, reply with exactly: DECORATIVE`;

/**
 * Send candidate images to GPT-4o Vision; returns a Map of image URL -> description (only for informational images).
 */
export async function describeImages(
  imageCandidates: ImageCandidate[]
): Promise<Map<string, string>> {
  if (imageCandidates.length === 0) return new Map();
  const openai = getOpenAI();
  const model = HTML_INGESTION_CONFIG.imageDescriptionModel ?? "gpt-4o";
  const result = new Map<string, string>();

  for (const candidate of imageCandidates) {
    try {
      const res = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              {
                type: "image_url",
                image_url: { url: candidate.url },
              },
            ],
          },
        ],
        max_tokens: 300,
      });
      const text = res.choices[0]?.message?.content?.trim() ?? "";
      if (text.toUpperCase() !== "DECORATIVE" && text.length > 0) {
        result.set(candidate.url, text);
      }
    } catch {
      // Skip this image on fetch or API error
    }
  }

  return result;
}

/**
 * Convert HTML to Markdown and inject image descriptions as blockquotes where images appear.
 */
export function htmlToMarkdownWithImages(
  html: string,
  baseUrl: string,
  imageDescriptions: Map<string, string>
): string {
  const turndown = new TurndownService({ headingStyle: "atx" });
  turndown.remove(["style", "script"]);
  let markdown = turndown.turndown(html);

  if (imageDescriptions.size === 0) return markdown;

  markdown = markdown.replace(IMAGE_MARKDOWN_REGEX, (_match, _alt, url) => {
    const resolved = resolveUrl(baseUrl, url);
    const desc = imageDescriptions.get(resolved);
    if (desc) {
      return `\n\n### Image\n\n> ${desc.split("\n").join("\n> ")}\n\n`;
    }
    return _match;
  });

  return markdown;
}

export type ExtractHtmlToMarkdownResult = {
  title: string;
  markdown: string;
  sourceUrl: string;
};

/**
 * Full pipeline: fetch URL, extract content, classify/describe images, convert to markdown.
 */
export async function extractHtmlToMarkdown(
  url: string,
  cssSelector?: string,
  renderJs: boolean = false
): Promise<ExtractHtmlToMarkdownResult> {
  const { title, html } = await fetchAndExtractHtml(url, cssSelector, renderJs);
  const candidates = classifyImages(html, url);
  const forVision = selectImagesForVision(candidates);
  const descriptions = await describeImages(forVision);
  const markdown = htmlToMarkdownWithImages(html, url, descriptions);
  return { title, markdown, sourceUrl: url };
}
