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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO anon, authenticated;

DO $policies$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT * FROM (VALUES
            ('select'),
            ('insert'),
            ('update'),
            ('delete')
        ) AS policies(command_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'branches'
              AND policyname = 'cashflow_dev_branches_' || policy_row.command_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.branches FOR %s TO anon, authenticated %s',
                'cashflow_dev_branches_' || policy_row.command_name,
                upper(policy_row.command_name),
                CASE policy_row.command_name
                    WHEN 'select' THEN 'USING (true)'
                    WHEN 'insert' THEN 'WITH CHECK (true)'
                    WHEN 'update' THEN 'USING (true) WITH CHECK (true)'
                    WHEN 'delete' THEN 'USING (true)'
                END
            );
        END IF;
    END LOOP;
END;
$policies$;

COMMIT;
