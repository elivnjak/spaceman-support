import "server-only";
import { JSDOM } from "jsdom";

export type RichTextProfile = "chat" | "telegram";

type SanitizerProfileConfig = {
  allowedTags: Set<string>;
  allowAnchorTarget: boolean;
};

const CHAT_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "p",
  "br",
  "ul",
  "ol",
  "li",
]);

const TELEGRAM_TAGS = new Set(["a", "b", "strong", "i", "em", "u", "s", "code", "br"]);

const PROFILE_CONFIG: Record<RichTextProfile, SanitizerProfileConfig> = {
  chat: {
    allowedTags: CHAT_TAGS,
    allowAnchorTarget: true,
  },
  telegram: {
    allowedTags: TELEGRAM_TAGS,
    allowAnchorTarget: false,
  },
};

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function isSafeHref(rawHref: string): boolean {
  const href = rawHref.trim();
  if (!href) return false;
  if (href.startsWith("#")) return true;
  if (href.startsWith("/")) return true;
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeChildren(
  sourceParent: Node,
  targetParent: Node,
  doc: Document,
  config: SanitizerProfileConfig
): void {
  sourceParent.childNodes.forEach((child) => {
    if (child.nodeType === doc.TEXT_NODE) {
      targetParent.appendChild(doc.createTextNode(child.textContent ?? ""));
      return;
    }

    if (child.nodeType !== doc.ELEMENT_NODE) return;

    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    if (!config.allowedTags.has(tag)) {
      sanitizeChildren(element, targetParent, doc, config);
      return;
    }

    if (tag === "a") {
      const href = element.getAttribute("href")?.trim() ?? "";
      if (!isSafeHref(href)) {
        sanitizeChildren(element, targetParent, doc, config);
        return;
      }
      const cleanAnchor = doc.createElement("a");
      cleanAnchor.setAttribute("href", href);
      if (config.allowAnchorTarget) {
        cleanAnchor.setAttribute("target", "_blank");
        cleanAnchor.setAttribute("rel", "noopener noreferrer");
      }
      sanitizeChildren(element, cleanAnchor, doc, config);
      targetParent.appendChild(cleanAnchor);
      return;
    }

    const cleanElement = doc.createElement(tag);
    sanitizeChildren(element, cleanElement, doc, config);
    targetParent.appendChild(cleanElement);
  });
}

export function sanitizeRichTextHtml(input: string, profile: RichTextProfile = "chat"): string {
  const config = PROFILE_CONFIG[profile];
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { document } = dom.window;
  const source = document.createElement("div");
  source.innerHTML = input;
  const out = document.createElement("div");
  sanitizeChildren(source, out, document, config);
  return out.innerHTML.trim();
}

export function richTextToPlainText(input: string): string {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { document } = dom.window;
  const source = document.createElement("div");
  source.innerHTML = input;
  source.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  source.querySelectorAll("p,li").forEach((node) => {
    if (node.lastChild?.nodeType === document.TEXT_NODE) {
      node.appendChild(document.createTextNode("\n"));
    }
  });

  return (source.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function richTextHasVisibleText(input: string): boolean {
  return richTextToPlainText(input).length > 0;
}
