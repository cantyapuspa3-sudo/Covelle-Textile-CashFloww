-- Add transaction evidence metadata and private Supabase Storage bucket.
-- Run after the base schema or branch migration and after reviewing RLS setup.
BEGIN;

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS evidence_path text,
    ADD COLUMN IF NOT EXISTS evidence_name varchar(255),
    ADD COLUMN IF NOT EXISTS evidence_mime_type varchar(100);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'cashflow-evidence',
    'cashflow-evidence',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $policies$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'cashflow_evidence_select'
    ) THEN
        CREATE POLICY cashflow_evidence_select ON storage.objects
            FOR SELECT TO anon, authenticated
            USING (bucket_id = 'cashflow-evidence');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'cashflow_evidence_insert'
    ) THEN
        CREATE POLICY cashflow_evidence_insert ON storage.objects
            FOR INSERT TO anon, authenticated
            WITH CHECK (bucket_id = 'cashflow-evidence');
    END IF;
END;
$policies$;

COMMIT;
