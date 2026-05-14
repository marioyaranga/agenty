/** Fila de `public.documents` usada en la UI de listado. */

export type DocumentRow = {
  id: string;
  tenant_id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  index_status: string;
  index_error: string | null;
  created_at: string;
  updated_at: string;
};
