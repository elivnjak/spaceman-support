import type { ImageEmbedder } from "./index";
import { EMBEDDING_CONFIG } from "@/lib/config";
import { withRetry } from "@/lib/retry";

const HF_API_URL_DEFAULT =
  "https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32";

const REPLICATE_TINYCLIP_VERSION =
  "f1905b91cb2d384a76764d14189c76b15daea3588197c67fe29042c7f386699c";

const HF_URL = process.env.HUGGINGFACE_CLIP_URL ?? HF_API_URL_DEFAULT;

function getReplicateToken(): string | undefined {
  return (
    process.env.REPLICATE_API_TOKEN?.trim() ||
    process.env.REPLICATE_API_KEY?.trim() ||
    undefined
  );
}
function getHfApiKey(): string | undefined {
  return process.env.HUGGINGFACE_API_KEY;
}

function hasReplicate(): boolean {
  return Boolean(getReplicateToken());
}

function hasHuggingFace(): boolean {
  return Boolean(getHfApiKey());
}

async function embedViaHuggingFace(imageBuffer: Buffer): Promise<number[]> {
  const HF_API_KEY = getHfApiKey();
  if (!HF_API_KEY)
    throw new Error(
      "HUGGINGFACE_API_KEY is not set. Set it or use REPLICATE_API_TOKEN for image embeddings."
    );

  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(imageBuffer),
  });

  if (res.status === 410 && getReplicateToken()) {
    return embedViaReplicate(imageBuffer);
  }
  if (res.status === 410) {
    throw new Error(
      "HuggingFace no longer serves this model (410 Gone). Use either: (1) HuggingFace Inference Endpoints — deploy openai/clip-vit-base-patch32 and set HUGGINGFACE_CLIP_URL to your endpoint, or (2) Replicate — set REPLICATE_API_TOKEN to use TinyCLIP (512-dim) for image embeddings."
    );
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HuggingFace CLIP API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as number[] | number[][];
  const flat =
    Array.isArray(data) && Array.isArray(data[0])
      ? (data as number[][])[0]
      : (data as number[]);
  if (
    !Array.isArray(flat) ||
    flat.length !== EMBEDDING_CONFIG.clipDimensions
  ) {
    throw new Error(
      `Unexpected CLIP response: expected array of length ${EMBEDDING_CONFIG.clipDimensions}`
    );
  }
  return flat;
}

async function embedViaReplicate(imageBuffer: Buffer): Promise<number[]> {
  const token = getReplicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");

  const imageBase64 = imageBuffer.toString("base64");

  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({
      version: REPLICATE_TINYCLIP_VERSION,
      input: { image_base64: imageBase64 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate CLIP API error: ${res.status} ${err}`);
  }

  const prediction = (await res.json()) as {
    status: string;
    output?: { image_vector?: number[] };
    error?: string;
  };

  if (prediction.status === "failed" || prediction.error) {
    throw new Error(
      `Replicate CLIP failed: ${prediction.error ?? prediction.status}`
    );
  }

  const vec = prediction.output?.image_vector;
  if (
    !Array.isArray(vec) ||
    vec.length !== EMBEDDING_CONFIG.clipDimensions
  ) {
    throw new Error(
      `Unexpected Replicate CLIP response: expected image_vector of length ${EMBEDDING_CONFIG.clipDimensions}`
    );
  }
  return vec;
}

export const clipEmbedder: ImageEmbedder = {
  async embed(imageBuffer: Buffer): Promise<number[]> {
    if (hasReplicate()) {
      return withRetry(() => embedViaReplicate(imageBuffer));
    }
    if (hasHuggingFace()) {
      return withRetry(() => embedViaHuggingFace(imageBuffer));
    }
    throw new Error(
      "Set either HUGGINGFACE_API_KEY (and optionally HUGGINGFACE_CLIP_URL) or REPLICATE_API_TOKEN for image embeddings."
    );
  },
};
