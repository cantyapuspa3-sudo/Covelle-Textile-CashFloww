-- Apply once in Supabase SQL Editor after taking a restorable database backup.
-- Existing category rows are archived before public.categories is removed.
-- Auth users must have app_metadata.role set to employee, approver, or
-- finance_manager by a trusted administrator (never user_metadata).

BEGIN;

CREATE SCHEMA IF NOT EXISTS cashflow_archive;
REVOKE ALL ON SCHEMA cashflow_archive FROM PUBLIC, anon, authenticated;

DO $archive_categories$
DECLARE
    source_rows bigint;
    archived_rows bigint;
BEGIN
    IF to_regclass('public.categories') IS NULL THEN
        RAISE EXCEPTION 'public.categories is missing; inspect the live database before migrating.';
    END IF;
    IF to_regclass('cashflow_archive.categories_20261010') IS NOT NULL THEN
        RAISE EXCEPTION 'Category archive already exists. Verify a previous migration before retrying.';
    END IF;

    SELECT count(*) INTO source_rows FROM public.categories;
    CREATE TABLE cashflow_archive.categories_20261010 AS
    SELECT * FROM public.categories;
    SELECT count(*) INTO archived_rows FROM cashflow_archive.categories_20261010;
    IF source_rows <> archived_rows THEN
        RAISE EXCEPTION 'Category archive count mismatch: source %, archive %.', source_rows, archived_rows;
    END IF;
END;
$archive_categories$;

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS reimbursement_id text;

UPDATE public.transactions t
SET category = COALESCE(NULLIF(t.category, ''), NULLIF(t.category_name_snapshot, ''), c.name)
FROM public.categories c
WHERE t.category_id = c.id
  AND (t.category IS NULL OR t.category = '');

ALTER TABLE public.approvals
    ALTER COLUMN transaction_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS reimbursement_id text,
    ADD COLUMN IF NOT EXISTS approver_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS notes text,
    ADD COLUMN IF NOT EXISTS approval_level integer NOT NULL DEFAULT 1;

DO $approval_action_constraints$
DECLARE
    constraint_row record;
BEGIN
    FOR constraint_row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.approvals'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid, true) ~* '\maction\M'
    LOOP
        EXECUTE format('ALTER TABLE public.approvals DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
    ALTER TABLE public.approvals
        ADD CONSTRAINT approvals_action_allowed CHECK (
            action IN ('Pending', 'Submitted', 'Under Review', 'Approved', 'Rejected',
                       'Revision Requested', 'Paid')
        );
END;
$approval_action_constraints$;

CREATE TABLE public.reimbursements (
    id text PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    employee_name text NOT NULL,
    department text NOT NULL,
    expense_date date NOT NULL,
    expense_category text NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    description text NOT NULL,
    receipt_storage_path text NOT NULL,
    receipt_original_name text NOT NULL,
    receipt_mime_type text NOT NULL CHECK (
        receipt_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    ),
    receipt_size_bytes bigint NOT NULL CHECK (receipt_size_bytes BETWEEN 1 AND 10485760),
    status text NOT NULL DEFAULT 'Draft' CHECK (
        status IN ('Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid')
    ),
    payment_cash_account_id varchar(50) REFERENCES public.cash_accounts(id) ON DELETE RESTRICT,
    payment_transaction_id varchar(100) UNIQUE,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reimbursements_receipt_path_unique UNIQUE (receipt_storage_path)
);

ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_reimbursement_fk
        FOREIGN KEY (reimbursement_id) REFERENCES public.reimbursements(id) ON DELETE RESTRICT;
ALTER TABLE public.reimbursements
    ADD CONSTRAINT reimbursements_payment_transaction_fk
        FOREIGN KEY (payment_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.approvals
    ADD CONSTRAINT approvals_reimbursement_fk
        FOREIGN KEY (reimbursement_id) REFERENCES public.reimbursements(id) ON DELETE RESTRICT,
    ADD CONSTRAINT approvals_exactly_one_target CHECK (
        (transaction_id IS NOT NULL)::integer + (reimbursement_id IS NOT NULL)::integer = 1
    );

CREATE UNIQUE INDEX IF NOT EXISTS approvals_idempotency_key_unique
    ON public.approvals(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS approvals_reimbursement_time_idx
    ON public.approvals(reimbursement_id, created_at, id)
    WHERE reimbursement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reimbursements_owner_time_idx
    ON public.reimbursements(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reimbursements_status_date_idx
    ON public.reimbursements(status, expense_date);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_reimbursement_unique
    ON public.transactions(reimbursement_id) WHERE reimbursement_id IS NOT NULL;

ALTER TABLE public.transactions
    DROP CONSTRAINT IF EXISTS transactions_category_id_fkey;
DO $remove_category_foreign_keys$
DECLARE
    fk record;
BEGIN
    FOR fk IN
        SELECT conname
        FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid = 'public.transactions'::regclass
          AND confrelid = 'public.categories'::regclass
    LOOP
        EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', fk.conname);
    END LOOP;
END;
$remove_category_foreign_keys$;
DROP TABLE public.categories RESTRICT;
DROP TRIGGER IF EXISTS cashflow_enforce_approval_sod ON public.approvals;

-- Replace legacy permissive policies so anonymous requests cannot read or write
-- business records. Application roles are signed into Supabase Auth.
DO $drop_legacy_policies$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY (ARRAY[
              'cash_accounts', 'transactions', 'approvals', 'reimbursements'
          ])
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I',
            policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    END LOOP;
END;
$drop_legacy_policies$;

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reimbursements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cash_accounts, public.transactions, public.approvals, public.reimbursements FROM anon;
GRANT SELECT ON public.cash_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cash_accounts TO authenticated;
GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reimbursements TO authenticated;
GRANT SELECT ON public.approvals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

CREATE POLICY cash_accounts_authenticated_read ON public.cash_accounts
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY cash_accounts_finance_manage ON public.cash_accounts
    FOR ALL TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager')
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager');

CREATE POLICY transactions_owner_or_approver_read ON public.transactions
    FOR SELECT TO authenticated
    USING (
        created_by_user_id = auth.uid()
        OR reimbursement_id IN (
            SELECT r.id FROM public.reimbursements r
            WHERE r.owner_id = auth.uid()
               OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
        )
        OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
    );
CREATE POLICY transactions_insert_own ON public.transactions
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND (
            status = 'Pending'
            OR (
                status = 'Posted'
                AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager'
            )
        )
    );

CREATE POLICY reimbursements_owner_or_approver_read ON public.reimbursements
    FOR SELECT TO authenticated
    USING (
        owner_id = auth.uid()
        OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
    );
CREATE POLICY reimbursements_owner_draft_insert ON public.reimbursements
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid() AND status = 'Draft');
CREATE POLICY reimbursements_owner_draft_update ON public.reimbursements
    FOR UPDATE TO authenticated
    USING (owner_id = auth.uid() AND status = 'Draft')
    WITH CHECK (owner_id = auth.uid() AND status = 'Draft');

CREATE POLICY approvals_related_read ON public.approvals
    FOR SELECT TO authenticated
    USING (
        (transaction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = approvals.transaction_id
              AND (
                t.created_by_user_id = auth.uid()
                OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
              )
        ))
        OR (reimbursement_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.reimbursements r
            WHERE r.id = approvals.reimbursement_id
              AND (
                r.owner_id = auth.uid()
                OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
              )
        ))
    );

-- Private evidence bucket: strict size/type allowlist; object key starts with
-- the authenticated owner's UUID. Approval roles can read attached evidence.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reimbursement-receipts', 'reimbursement-receipts', false, 10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DO $storage_policies$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'cashflow_receipt_owner_upload') THEN
        CREATE POLICY cashflow_receipt_owner_upload ON storage.objects
            FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'reimbursement-receipts'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND EXISTS (
                    SELECT 1 FROM public.reimbursements r
                    WHERE r.owner_id = auth.uid()
                      AND r.status = 'Draft'
                      AND r.receipt_storage_path = name
                )
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'cashflow_receipt_related_read') THEN
        CREATE POLICY cashflow_receipt_related_read ON storage.objects
            FOR SELECT TO authenticated
            USING (
                bucket_id = 'reimbursement-receipts'
                AND (
                    (storage.foldername(name))[1] = auth.uid()::text
                    OR (
                        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('approver', 'finance_manager')
                        AND EXISTS (
                            SELECT 1 FROM public.reimbursements r
                            WHERE r.receipt_storage_path = name
                        )
                    )
                )
            );
    END IF;
END;
$storage_policies$;

CREATE OR REPLACE FUNCTION public.cashflow_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Approval history is append-only.';
END;
$function$;
DROP TRIGGER IF EXISTS approvals_immutable_history ON public.approvals;
CREATE TRIGGER approvals_immutable_history
BEFORE UPDATE OR DELETE ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.cashflow_log_immutable();

CREATE OR REPLACE FUNCTION public.cashflow_record_approval(
    p_target_kind text,
    p_target_id text,
    p_action text,
    p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
    actor_id uuid := auth.uid();
    actor_role text := auth.jwt() -> 'app_metadata' ->> 'role';
    actor_email text := auth.jwt() ->> 'email';
    actor_name text := COALESCE(
        NULLIF(auth.jwt() -> 'app_metadata' ->> 'full_name', ''),
        NULLIF(actor_email, ''),
        actor_id::text
    );
    owner_id uuid;
    creator_id uuid;
    creator_name text;
    requester_name text;
    current_status text;
    reimbursement_row public.reimbursements%ROWTYPE;
    next_status text;
BEGIN
    IF actor_id IS NULL OR actor_role NOT IN ('approver', 'finance_manager') THEN
        RAISE EXCEPTION 'Approver or finance_manager role required.';
    END IF;
    IF p_action NOT IN ('Under Review', 'Approved', 'Rejected', 'Revision Requested') THEN
        RAISE EXCEPTION 'Unsupported approval action.';
    END IF;
    IF p_notes IS NULL OR length(btrim(p_notes)) < 1 OR length(p_notes) > 2000 THEN
        RAISE EXCEPTION 'Approval note is required and must not exceed 2000 characters.';
    END IF;

    IF p_target_kind = 'transaction' THEN
        IF p_action NOT IN ('Approved', 'Rejected', 'Revision Requested') THEN
            RAISE EXCEPTION 'Invalid transaction decision.';
        END IF;
        SELECT created_by_user_id, created_by, requester, status
        INTO creator_id, creator_name, requester_name, current_status
        FROM public.transactions WHERE id = p_target_id FOR UPDATE;
        IF NOT FOUND OR current_status <> 'Pending' THEN
            RAISE EXCEPTION 'Transaction does not exist or is no longer pending.';
        END IF;
        IF creator_id IS NULL THEN
            RAISE EXCEPTION 'Transaction owner is not linked to Auth; map it before approval.';
        END IF;
        IF creator_id = actor_id
           OR lower(btrim(COALESCE(creator_name, ''))) = lower(btrim(actor_name))
           OR lower(btrim(COALESCE(requester_name, ''))) = lower(btrim(actor_name)) THEN
            RAISE EXCEPTION 'Segregation of duties violation.';
        END IF;

        INSERT INTO public.approvals (
            transaction_id, approver_id, approver_user_id, approver_name_snapshot,
            approval_level, action, notes, approved_at, idempotency_key
        ) VALUES (
            p_target_id, actor_id::text, actor_id, actor_name,
            COALESCE((SELECT max(a.approval_level) + 1 FROM public.approvals a WHERE a.transaction_id = p_target_id), 1),
            p_action, btrim(p_notes), now(),
            'tx:' || p_target_id || ':' || gen_random_uuid()::text
        );
        UPDATE public.transactions
        SET status = CASE p_action WHEN 'Approved' THEN 'Approved'
                                   WHEN 'Rejected' THEN 'Rejected'
                                   ELSE 'Revision Requested' END,
            updated_at = now()
        WHERE id = p_target_id;
    ELSIF p_target_kind = 'reimbursement' THEN
        SELECT * INTO reimbursement_row
        FROM public.reimbursements WHERE id = p_target_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reimbursement does not exist.';
        END IF;
        IF reimbursement_row.status NOT IN ('Submitted', 'Under Review') THEN
            RAISE EXCEPTION 'Reimbursement is not awaiting review.';
        END IF;
        IF reimbursement_row.owner_id = actor_id THEN
            RAISE EXCEPTION 'Segregation of duties violation.';
        END IF;
        next_status := CASE p_action
            WHEN 'Under Review' THEN 'Under Review'
            WHEN 'Approved' THEN 'Approved'
            WHEN 'Rejected' THEN 'Rejected'
            ELSE 'Submitted'
        END;

        INSERT INTO public.approvals (
            reimbursement_id, approver_id, approver_user_id, approver_name_snapshot,
            approval_level, action, notes, approved_at, idempotency_key
        ) VALUES (
            p_target_id, actor_id::text, actor_id, actor_name,
            COALESCE((SELECT max(a.approval_level) + 1 FROM public.approvals a WHERE a.reimbursement_id = p_target_id), 1),
            p_action, btrim(p_notes), now(),
            'rb:' || p_target_id || ':' || gen_random_uuid()::text
        );
        UPDATE public.reimbursements
        SET status = next_status, updated_at = now()
        WHERE id = p_target_id;
    ELSE
        RAISE EXCEPTION 'Unsupported approval target.';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.cashflow_record_approval(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashflow_record_approval(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashflow_submit_reimbursement(p_reimbursement_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
    actor_id uuid := auth.uid();
    reimbursement_row public.reimbursements%ROWTYPE;
BEGIN
    SELECT * INTO reimbursement_row
    FROM public.reimbursements
    WHERE id = p_reimbursement_id
    FOR UPDATE;
    IF NOT FOUND OR reimbursement_row.owner_id <> actor_id OR reimbursement_row.status <> 'Draft' THEN
        RAISE EXCEPTION 'Only the owner can submit their draft reimbursement.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'reimbursement-receipts'
          AND name = reimbursement_row.receipt_storage_path
    ) THEN
        RAISE EXCEPTION 'The reimbursement receipt must be uploaded before submission.';
    END IF;

    UPDATE public.reimbursements
    SET status = 'Submitted', submitted_at = now(), updated_at = now()
    WHERE id = p_reimbursement_id;
    INSERT INTO public.approvals (
        reimbursement_id, approver_id, approver_user_id, approver_name_snapshot,
        approval_level, action, notes, approved_at, idempotency_key
    ) VALUES (
        p_reimbursement_id, actor_id::text, actor_id,
        COALESCE(NULLIF(auth.jwt() -> 'app_metadata' ->> 'full_name', ''), auth.jwt() ->> 'email', actor_id::text),
        0, 'Submitted', 'Pengajuan dikirim untuk ditinjau.', now(),
        'submit:' || p_reimbursement_id
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.cashflow_submit_reimbursement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashflow_submit_reimbursement(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashflow_pay_reimbursement(
    p_reimbursement_id text,
    p_cash_account_id varchar(50)
)
RETURNS varchar(100)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
    actor_id uuid := auth.uid();
    actor_role text := auth.jwt() -> 'app_metadata' ->> 'role';
    reimbursement_row public.reimbursements%ROWTYPE;
    transaction_key text;
    cash_branch_id varchar(50);
BEGIN
    IF actor_id IS NULL OR actor_role <> 'finance_manager' THEN
        RAISE EXCEPTION 'Finance manager role required to pay reimbursements.';
    END IF;

    SELECT * INTO reimbursement_row
    FROM public.reimbursements
    WHERE id = p_reimbursement_id
    FOR UPDATE;
    IF NOT FOUND OR reimbursement_row.status <> 'Approved' THEN
        RAISE EXCEPTION 'Only an approved, unpaid reimbursement can be paid.';
    END IF;
    IF reimbursement_row.payment_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Reimbursement already has a payment transaction.';
    END IF;
    SELECT branch_id INTO cash_branch_id
    FROM public.cash_accounts
    WHERE id = p_cash_account_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment cash/bank account does not exist or is inactive.';
    END IF;

    transaction_key := 'RBP-' || replace(p_reimbursement_id, '-', '');
    INSERT INTO public.transactions (
        id, type, transaction_date, cash_account_id, branch_id, department,
        category, vendor, requester, amount, description, status,
        created_by, created_by_user_id, reimbursement_id, created_at, updated_at
    ) VALUES (
        transaction_key, 'cash-out', current_date, p_cash_account_id, cash_branch_id,
        reimbursement_row.department, reimbursement_row.expense_category,
        reimbursement_row.employee_name, reimbursement_row.employee_name,
        reimbursement_row.amount,
        'Reimbursement ' || p_reimbursement_id || ': ' || reimbursement_row.description,
        'Posted', reimbursement_row.employee_name, reimbursement_row.owner_id,
        p_reimbursement_id, now(), now()
    );

    UPDATE public.reimbursements
    SET status = 'Paid', payment_cash_account_id = p_cash_account_id,
        payment_transaction_id = transaction_key, updated_at = now()
    WHERE id = p_reimbursement_id;

    INSERT INTO public.approvals (
        reimbursement_id, approver_id, approver_user_id, approver_name_snapshot,
        approval_level, action, notes, approved_at, idempotency_key
    ) VALUES (
        p_reimbursement_id, actor_id::text, actor_id,
        COALESCE(NULLIF(auth.jwt() -> 'app_metadata' ->> 'full_name', ''), auth.jwt() ->> 'email', actor_id::text),
        COALESCE((SELECT max(a.approval_level) + 1 FROM public.approvals a WHERE a.reimbursement_id = p_reimbursement_id), 1),
        'Paid', 'Pembayaran tercatat pada transaksi ' || transaction_key, now(),
        'paid:' || p_reimbursement_id
    );
    RETURN transaction_key;
END;
$function$;
REVOKE ALL ON FUNCTION public.cashflow_pay_reimbursement(text, varchar) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashflow_pay_reimbursement(text, varchar) TO authenticated;

-- Remove direct client ability to rewrite transaction status; approved changes
-- must be appended via the RPC above.
REVOKE UPDATE, DELETE ON public.transactions FROM authenticated;

COMMIT;
