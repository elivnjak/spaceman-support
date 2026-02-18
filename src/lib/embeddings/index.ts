export interface TextEmbedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface ImageEmbedder {
  embed(imageBuffer: Buffer): Promise<number[]>;
}
