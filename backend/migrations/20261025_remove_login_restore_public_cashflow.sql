-- Restore the legacy no-login CashFlow application after the Auth migration.
-- This makes company cash data available to anyone who can reach the public app.
-- Keep this migration out of environments that require private business data.
BEGIN;

DO $drop_cashflow_policies$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY (ARRAY['branches', 'cash_accounts', 'transactions', 'approvals'])
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I',
            policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    END LOOP;
END;
$drop_cashflow_policies$;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches, public.cash_accounts TO anon, authenticated;
GRANT SELECT, INSERT ON public.transactions TO anon, authenticated;
GRANT SELECT ON public.approvals TO anon, authenticated;
REVOKE UPDATE, DELETE ON public.transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM anon, authenticated;

CREATE POLICY cashflow_public_branches_read ON public.branches
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cashflow_public_branches_manage ON public.branches
    FOR ALL TO anon, authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY cashflow_public_accounts_read ON public.cash_accounts
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cashflow_public_accounts_manage ON public.cash_accounts
    FOR ALL TO anon, authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY cashflow_public_transactions_read ON public.transactions
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cashflow_public_transactions_insert ON public.transactions
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        (status = 'Pending' AND type IN ('cash-out', 'petty-expense', 'cash-request'))
        OR (status = 'Posted' AND type IN (
            'cash-in', 'cash-transfer', 'petty-topup', 'petty-replenishment'
        ))
    );

CREATE POLICY cashflow_public_approvals_read ON public.approvals
    FOR SELECT TO anon, authenticated USING (transaction_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.cashflow_record_public_transaction_approval(
    p_target_id text,
    p_action text,
    p_approver_name text,
    p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    transaction_row public.transactions%ROWTYPE;
    approver_name text := btrim(COALESCE(p_approver_name, ''));
    notes_text text := btrim(COALESCE(p_notes, ''));
BEGIN
    IF p_action NOT IN ('Approved', 'Rejected', 'Revision Requested') THEN
        RAISE EXCEPTION 'Unsupported transaction approval action.';
    END IF;
    IF length(approver_name) NOT BETWEEN 1 AND 150 THEN
        RAISE EXCEPTION 'Approver name is required and must not exceed 150 characters.';
    END IF;
    IF length(notes_text) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Approval note is required and must not exceed 2000 characters.';
    END IF;

    SELECT * INTO transaction_row
    FROM public.transactions
    WHERE id = p_target_id
    FOR UPDATE;
    IF NOT FOUND OR transaction_row.status <> 'Pending' THEN
        RAISE EXCEPTION 'Transaction does not exist or is no longer pending.';
    END IF;
    IF lower(approver_name) = lower(btrim(COALESCE(transaction_row.created_by, '')))
       OR lower(approver_name) = lower(btrim(COALESCE(transaction_row.requester, ''))) THEN
        RAISE EXCEPTION 'A requester or creator cannot approve their own transaction.';
    END IF;

    INSERT INTO public.approvals (
        transaction_id, approver_id, approver_name_snapshot,
        approval_level, action, notes, approved_at, idempotency_key
    ) VALUES (
        p_target_id, 'public', approver_name,
        COALESCE((SELECT max(a.approval_level) + 1
                  FROM public.approvals a WHERE a.transaction_id = p_target_id), 1),
        p_action, notes_text, now(),
        'public:' || p_target_id || ':' || gen_random_uuid()::text
    );

    UPDATE public.transactions
    SET status = p_action, updated_at = now()
    WHERE id = p_target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cashflow_record_public_transaction_approval(text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cashflow_record_public_transaction_approval(text, text, text, text)
    TO anon, authenticated;

COMMIT;
