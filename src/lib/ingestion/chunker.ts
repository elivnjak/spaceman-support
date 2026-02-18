const DEFAULT_CHUNK_TOKENS = 600;
const OVERLAP_TOKENS = 100;
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Hard ceiling in characters for any single chunk before it is sent to the embedding model.
 * text-embedding-3-small has an 8191-token limit. Technical content (numbers, short words,
 * URLs, special chars) can average as low as ~2 chars per token, so we use a conservative
 * multiplier of 2 to guarantee safety: 6000 tokens * 2 chars/token = 12000 chars.
 */
const EMBEDDING_MAX_TOKENS = 6000;
const CONSERVATIVE_CHARS_PER_TOKEN = 2;
const MAX_SAFE_CHUNK_CHARS = EMBEDDING_MAX_TOKENS * CONSERVATIVE_CHARS_PER_TOKEN;

function roughTokenCount(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

/**
 * Split a chunk that exceeds the safe embedding size into smaller chunks.
 * Preserves metadata on all sub-chunks (first chunk keeps original, rest get split_index).
 */
function splitOversizedChunk(
  chunk: { content: string; metadata: Record<string, unknown> }
): { content: string; metadata: Record<string, unknown> }[] {
  if (chunk.content.length <= MAX_SAFE_CHUNK_CHARS) {
    return [chunk];
  }
  const parts = chunkBySize(chunk.content, DEFAULT_CHUNK_TOKENS, OVERLAP_TOKENS);
  return parts.map((p, i) => ({
    content: p.content,
    metadata: i === 0 ? chunk.metadata : { ...chunk.metadata, split_index: i },
  }));
}

export function chunkBySize(
  text: string,
  maxTokens: number = DEFAULT_CHUNK_TOKENS,
  overlapTokens: number = OVERLAP_TOKENS
): { content: string; start: number; end: number }[] {
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;
  const chunks: { content: string; start: number; end: number }[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    let slice = text.slice(start, end);

    if (end < text.length) {
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > maxChars * 0.5) {
        end = start + lastSpace + 1;
        slice = text.slice(start, end);
      }
    }

    if (slice.trim()) {
      chunks.push({ content: slice.trim(), start, end });
    }
    start = end - (end < text.length ? overlapChars : 0);
    if (start >= text.length) break;
  }

  return chunks;
}

const PAGE_COMMENT_REGEX = /^\s*<!--\s*page\s+(\d+)\s*-->\s*$/i;

export function chunkByHeadings(text: string): {
  content: string;
  metadata: { heading?: string; page?: number };
}[] {
  const lines = text.split("\n");
  const chunks: { content: string; metadata: { heading?: string; page?: number } }[] = [];
  let currentHeading: string | undefined;
  let currentPage: number | undefined;
  let currentContent: string[] = [];
  const maxChunkChars = DEFAULT_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

  function flush() {
    const joined = currentContent.join("\n").trim();
    if (!joined) {
      currentContent = [];
      return;
    }
    const metadata: { heading?: string; page?: number } = {};
    if (currentHeading) metadata.heading = currentHeading;
    if (currentPage != null) metadata.page = currentPage;

    // If flushed content exceeds the safe embedding limit, split it into smaller pieces
    if (joined.length > MAX_SAFE_CHUNK_CHARS) {
      const subChunks = chunkBySize(joined, DEFAULT_CHUNK_TOKENS, OVERLAP_TOKENS);
      for (const sub of subChunks) {
        chunks.push({ content: sub.content, metadata: { ...metadata } });
      }
    } else {
      chunks.push({ content: joined, metadata });
    }
    currentContent = [];
  }

  for (const line of lines) {
    const pageComment = line.match(PAGE_COMMENT_REGEX);
    if (pageComment) {
      currentPage = parseInt(pageComment[1]!, 10);
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      flush();
      currentHeading = match[2].trim();
      currentContent = [line];
    } else {
      currentContent.push(line);
      if (currentContent.join("\n").length >= maxChunkChars) {
        flush();
        currentHeading = undefined;
      }
    }
  }
  flush();

  if (chunks.length === 0 && text.trim()) {
    return chunkBySize(text).map((c) => ({ content: c.content, metadata: {} }));
  }
  return chunks;
}

/**
 * Detect markdown table blocks and flatten to key-value lines for better embedding.
 * Returns null if no tables found. Section is the preceding ## heading or "Table".
 */
export function flattenTablesToKV(markdown: string): string | null {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let section = "Table";
  let headerCells: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      section = headingMatch[1].trim();
      inTable = false;
      continue;
    }
    const pipeCount = (line.match(/\|/g) ?? []).length;
    if (pipeCount >= 2) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (!inTable) {
        if (cells.length > 0 && !/^[-:]+$/.test(cells.join(""))) {
          headerCells = cells;
          inTable = true;
        }
        continue;
      }
      if (cells.length > 0 && /^[-:\s]+$/.test(cells.join(""))) continue;
      if (cells.length >= 1 && cells.length <= headerCells.length) {
        const pairs = cells.map((val, j) => {
          const key = headerCells[j] ?? `Col${j + 1}`;
          return `${key}=${val}`;
        });
        result.push(`${section}: ${pairs.join(", ")}`);
      }
    } else {
      inTable = false;
    }
  }
  return result.length > 0 ? result.join("\n") : null;
}

export function chunkMarkdownOrText(
  text: string,
  format: "md" | "txt" = "txt"
): { content: string; metadata: Record<string, unknown> }[] {
  let chunks: { content: string; metadata: Record<string, unknown> }[];
  if (format === "md") {
    const byHeadings = chunkByHeadings(text);
    chunks = byHeadings.map((c) => ({ content: c.content, metadata: c.metadata }));
  } else {
    chunks = chunkBySize(text).map((c) => ({ content: c.content, metadata: {} }));
  }
  // Ensure no chunk exceeds embedding/LLM token limits (e.g. text-embedding-3-small 8191, some chat models 8192)
  return chunks.flatMap(splitOversizedChunk);
}
