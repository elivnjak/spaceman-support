import OpenAI from "openai";
import { INGESTION_CONFIG } from "@/lib/config";

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

function buildExtractionPrompt(pageNumbers: number[]): string {
  const pageList = pageNumbers.join(", ");
  return `You are extracting structured content from a PDF document. Extract ONLY the content from the following page(s): ${pageList}.

Rules:
1. Output ONLY valid markdown. No preamble or explanation.
2. Use ## Section Name headings for each major section (e.g. FEATURES, SPECIFICATIONS, ELECTRICAL).
3. Reproduce every table as a markdown table with a header row and alignment row (e.g. | --- | --- |). Keep column headers and cell values exactly as they appear.
4. Insert a comment marker at the start of each page's content: <!-- page N --> (where N is the page number).
5. Reproduce every number and value EXACTLY as shown. Do not round, convert units, or summarize. If you are unsure about a value, append [?] to it.
6. Preserve units (mm, in, kg, lb, kW, A, etc.) with their values.
7. Do not add content that is not in the PDF.`;
}

export type ExtractPagesWithVisionResult = {
  markdown: string;
  pagesProcessed: number[];
};

/**
 * Extract structured markdown from the given PDF pages using the OpenAI Responses API
 * with input_file (file_id from Files API). Only call this for table-heavy pages.
 */
export async function extractPagesWithVision(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<ExtractPagesWithVisionResult> {
  if (pageNumbers.length === 0) {
    return { markdown: "", pagesProcessed: [] };
  }

  const openai = getOpenAI();

  const file = await openai.files.create({
    file: new File([new Uint8Array(buffer)], "document.pdf", { type: "application/pdf" }),
    purpose: "user_data",
  });

  try {
    const response = await openai.responses.create({
      model: INGESTION_CONFIG.visionModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: file.id },
            { type: "input_text", text: buildExtractionPrompt(pageNumbers) },
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

    return {
      markdown: outputText.trim(),
      pagesProcessed: [...pageNumbers],
    };
  } finally {
    await openai.files.del(file.id);
  }
}
