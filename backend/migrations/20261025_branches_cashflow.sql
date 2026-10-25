-- Add branch ownership to the existing CashFlow tables without dropping data.
-- Run after taking a backup and reviewing existing RLS policies/dependencies.
BEGIN;

CREATE TABLE IF NOT EXISTS public.branches (
    id varchar(50) PRIMARY KEY,
    code varchar(30) NOT NULL UNIQUE,
    name varchar(150) NOT NULL UNIQUE,
    location varchar(150),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.branches (id, code, name, location)
VALUES
    ('BR-HQ', 'HQ', 'Kantor Pusat', 'Kantor Pusat'),
    ('BR-FACTORY', 'FACTORY', 'Pabrik', 'Pabrik')
ON CONFLICT DO NOTHING;

ALTER TABLE public.cash_accounts
    ADD COLUMN IF NOT EXISTS branch_id varchar(50);

UPDATE public.cash_accounts
SET branch_id = 'BR-HQ'
WHERE branch_id IS NULL;

ALTER TABLE public.cash_accounts
    ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS branch_id varchar(50);

UPDATE public.transactions AS transaction_row
SET branch_id = COALESCE(
    (SELECT account.branch_id FROM public.cash_accounts AS account
     WHERE account.id = transaction_row.cash_account_id),
    (SELECT account.branch_id FROM public.cash_accounts AS account
     WHERE account.id = transaction_row.source_cash_account_id),
    'BR-HQ'
)
WHERE transaction_row.branch_id IS NULL;

ALTER TABLE public.transactions
    ALTER COLUMN branch_id SET NOT NULL;

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'cash_accounts_branch_id_fkey'
          AND conrelid = 'public.cash_accounts'::regclass
    ) THEN
        ALTER TABLE public.cash_accounts
            ADD CONSTRAINT cash_accounts_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'transactions_branch_id_fkey'
          AND conrelid = 'public.transactions'::regclass
    ) THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
    END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS idx_transactions_branch_date
    ON public.transactions(branch_id, transaction_date);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;

DO $policies$
BEGIN
    DROP POLICY IF EXISTS cashflow_dev_branches_select ON public.branches;
    DROP POLICY IF EXISTS cashflow_dev_branches_insert ON public.branches;
    DROP POLICY IF EXISTS cashflow_dev_branches_update ON public.branches;
    DROP POLICY IF EXISTS cashflow_dev_branches_delete ON public.branches;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname = 'cashflow_branches_authenticated_read') THEN
        CREATE POLICY cashflow_branches_authenticated_read ON public.branches
            FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname = 'cashflow_branches_finance_manage') THEN
        CREATE POLICY cashflow_branches_finance_manage ON public.branches
            FOR ALL TO authenticated
            USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager')
            WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager');
    END IF;
END;
$policies$;

COMMIT;
