import OpenAI from "openai";
import { INGESTION_CONFIG } from "@/lib/config";

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

export type LlmChunk = {
  id: string;
  content: string;
  metadata: {
    title: string;
    tags: string[];
    page_start: number;
    page_end: number;
    doc_type: string;
    source: "llm_chunker";
  };
};

export type LlmChunkerResult = {
  chunks: LlmChunk[];
  rawMarkdown: string;
};

const SYSTEM_PROMPT = `You are a document chunking specialist for a RAG system that powers a technical support diagnostic chatbot. The chatbot helps end-users troubleshoot equipment problems by retrieving relevant chunks when a user describes a symptom or asks a question. Your job is to produce chunks that will surface precisely for the right query.

Documents can be anything: product spec sheets, service manuals, troubleshooting guides, parts lists, training materials, knowledge base articles, policy documents, or general reference. Adapt your chunking to the document type — not every document is a spec sheet.

CRITICAL RULES:
1. Output ONLY valid JSON matching the schema below. No preamble, no explanation, no markdown fences.
2. Reproduce every number, measurement, and value EXACTLY as shown in the document. Never round, convert units, or summarize numeric data.
3. Do not invent or hallucinate content. Only include information present in the document.
4. If you are unsure about a value, append [?] to it.
5. Preserve units (mm, in, kg, lb, kW, A, etc.) with their values.
6. Fix obvious OCR/layout typos (e.g. "Sysetm" → "System", "tempearture" → "temperature") but never change actual values.

CHUNKING STRATEGY — optimize for diagnostic retrieval:
- NEVER combine different topics into one chunk. Each chunk = ONE retrievable answer to a potential user question.
- Split aggressively. More small focused chunks are better than fewer large mixed ones. As a guideline: ~4-8 chunks per page of content.
- Think: "If a user asked about THIS specific topic, would this chunk — and only this chunk — give them a clean answer?" If a chunk covers two topics, split it.

Adapt topic splitting to the document type. Examples of topics that should ALWAYS be their own chunk when present:

For SPEC SHEETS:
  • Product overview / model identification
  • Each major feature or feature group
  • Safety protections and shutoffs
  • Each operating mode (standby, auto, manual)
  • Core specifications (capacity, output rate)
  • Physical dimensions and weight (separate from core specs)
  • Electrical specifications (ALWAYS its own chunk)
  • Feature checklist / included vs optional
  • Contact / supplier information

For SERVICE MANUALS:
  • Each maintenance procedure (cleaning, lubrication, calibration — one chunk each)
  • Each disassembly/reassembly procedure
  • Each diagnostic or inspection step
  • Fluid/lubricant specifications
  • Torque values / adjustment specs
  • Service intervals / schedules
  • Required tools list
  • Safety warnings and precautions

For TROUBLESHOOTING GUIDES:
  • Each symptom/problem as its own chunk (e.g. "Motor won't start", "Product too soft")
  • Each error code or indicator light meaning
  • Each cause-and-fix pair
  • Decision trees or diagnostic flowcharts (as text steps)

For PARTS LISTS:
  • Each assembly or sub-assembly group
  • Each component with part number, description, quantity

For GENERAL / KNOWLEDGE BASE / POLICY:
  • Each distinct topic, procedure, or FAQ answer
  • Each policy rule or guideline
  • Each section that answers a standalone question

FORMATTING RULES:
- Tables should be converted to clean key-value text lines (e.g. "Power (220-240V/50Hz/1ph): 1.8 kW") — NOT markdown table syntax. Key-value lines embed far better for vector search.
- Every chunk MUST include enough context to stand alone: include the product/machine model name or document subject so retrieval doesn't depend on neighboring chunks.
- Tags should include terms a user or technician might actually search for, including symptom language (e.g. "overheating", "leaking", "error code", "won't start", "noisy").

OUTPUT SCHEMA (JSON array):
[
  {
    "id": "string — short identifier like DOC-000, DOC-010, DOC-020 etc. (use model number as prefix when available)",
    "title": "string — concise chunk title describing the single topic",
    "page_start": number,
    "page_end": number,
    "tags": ["array", "of", "relevant", "search", "and", "diagnostic", "keywords"],
    "doc_type": "string — one of: product_spec_sheet, service_manual, troubleshooting_guide, parts_list, training_material, knowledge_base, policy, general",
    "content": "string — the chunk content as clean readable text with line breaks. Must include contextual identifiers (model name, document subject, etc.)."
  }
]`;

function buildUserPrompt(fileName: string, numPages: number): string {
  return `Chunk the following PDF document into semantically coherent pieces for a RAG system.

Source file: ${fileName}
Total pages: ${numPages}

The PDF content follows. Read ALL pages and produce chunks covering the entire document.`;
}

/**
 * Use an LLM with vision to read a PDF and produce semantically chunked output.
 * Uploads the PDF via the Files API and uses the Responses API with input_file.
 */
export async function chunkDocumentWithLlm(
  buffer: Buffer,
  fileName: string,
  numPages: number,
): Promise<LlmChunkerResult> {
  const openai = getOpenAI();

  const file = await openai.files.create({
    file: new File([new Uint8Array(buffer)], fileName, { type: "application/pdf" }),
    purpose: "user_data",
  });

  try {
    const response = await openai.responses.create({
      model: INGESTION_CONFIG.llmChunkerModel,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            { type: "input_file", file_id: file.id },
            { type: "input_text", text: buildUserPrompt(fileName, numPages) },
          ],
        },
      ],
    });

    const outputText =
      (response as { output_text?: string }).output_text ??
      (response.output as Array<{ type?: string; text?: string }>)
        ?.filter((item) => item.type === "output_text")
        .map((item) => item.text)
        .join("") ??
      "";

    const cleaned = outputText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");

    const parsed = JSON.parse(cleaned) as Array<{
      id: string;
      title: string;
      page_start: number;
      page_end: number;
      tags: string[];
      doc_type: string;
      content: string;
    }>;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("LLM chunker returned empty or non-array response");
    }

    const chunks: LlmChunk[] = parsed.map((item) => ({
      id: item.id,
      content: item.content,
      metadata: {
        title: item.title,
        tags: item.tags ?? [],
        page_start: item.page_start,
        page_end: item.page_end,
        doc_type: item.doc_type ?? "general",
        source: "llm_chunker" as const,
      },
    }));

    return {
      chunks,
      rawMarkdown: chunks.map((c) => c.content).join("\n\n---\n\n"),
    };
  } finally {
    await openai.files.del(file.id).catch(() => {});
  }
}
