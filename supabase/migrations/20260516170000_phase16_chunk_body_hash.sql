-- Fase 16: hash del body de cada chunk para re-embeddéo incremental.
-- Permite detectar qué chunks cambiaron al re-indexar un documento y solo
-- re-embeddear los fragmentos nuevos, en lugar de todo el archivo.

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS body_hash TEXT;

CREATE INDEX IF NOT EXISTS document_chunks_body_hash ON public.document_chunks (document_id, body_hash);
