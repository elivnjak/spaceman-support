ALTER TABLE "doc_chunks"
ADD COLUMN IF NOT EXISTS "search_vector" tsvector
GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_search_vector_gin_idx"
ON "doc_chunks" USING GIN ("search_vector");
