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
    DROP POLICY IF EXISTS cashflow_evidence_select ON storage.objects;
    DROP POLICY IF EXISTS cashflow_evidence_insert ON storage.objects;
    CREATE POLICY cashflow_evidence_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'cashflow-evidence'
            AND (
                (storage.foldername(name))[1] = auth.uid()::text
                OR (
                    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
                    AND EXISTS (
                        SELECT 1 FROM public.transactions transaction_row
                        WHERE transaction_row.evidence_path = storage.objects.name
                    )
                )
            )
        );
    CREATE POLICY cashflow_evidence_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'cashflow-evidence'
            AND (storage.foldername(name))[1] = auth.uid()::text
        );
END;
$policies$;

COMMIT;
