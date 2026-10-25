-- Covelle Textile CashFlow: five public business tables.
-- For an existing installation, run migrations/20261025_branches_cashflow.sql
-- instead of rerunning this setup.
-- This schema contains the five business tables used by the simplified app.
-- This no-login setup exposes cash data through the public anon role. Do not
-- use it for confidential or production data without adding authenticated RLS.

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

CREATE TABLE IF NOT EXISTS public.cash_accounts (
    id varchar(50) PRIMARY KEY,
    code varchar(30) NOT NULL UNIQUE,
    name varchar(150) NOT NULL UNIQUE,
    account_type varchar(30) NOT NULL CHECK (account_type IN ('Petty Cash', 'Cash', 'Bank')),
    branch_id varchar(50) NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    location varchar(150),
    custodian varchar(150),
    opening_balance numeric(18,2) NOT NULL DEFAULT 0,
    minimum_balance numeric(18,2) NOT NULL DEFAULT 0,
    maximum_balance numeric(18,2) NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
    id varchar(50) PRIMARY KEY,
    code varchar(30) UNIQUE,
    name varchar(100) NOT NULL UNIQUE,
    category_type varchar(100),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
    id varchar(100) PRIMARY KEY,
    type varchar(50) NOT NULL CONSTRAINT chk_transaction_type CHECK (
        type IN (
            'petty-topup', 'petty-expense', 'petty-replenishment',
            'cash-in', 'cash-out', 'cash-transfer', 'cash-request'
        )
    ),
    transaction_date date NOT NULL,
    branch_id varchar(50) NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    source_cash_account_id varchar(50) REFERENCES public.cash_accounts(id) ON DELETE RESTRICT,
    cash_account_id varchar(50) REFERENCES public.cash_accounts(id) ON DELETE RESTRICT,
    department varchar(100),
    department_name_snapshot text,
    category varchar(100),
    category_name_snapshot text,
    category_id varchar(50) REFERENCES public.categories(id) ON DELETE RESTRICT,
    vendor varchar(150),
    requester varchar(150),
    required_date date,
    amount numeric(18,2) NOT NULL CONSTRAINT chk_transaction_amount CHECK (amount >= 0),
    description text,
    evidence_path text,
    evidence_name varchar(255),
    evidence_mime_type varchar(100),
    status varchar(30) NOT NULL DEFAULT 'Pending' CHECK (
        status IN ('Pending', 'Approved', 'Posted', 'Rejected', 'Revision Requested', 'Submitted')
    ),
    created_by varchar(150),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id varchar(100) NOT NULL
        REFERENCES public.transactions(id) ON DELETE RESTRICT,
    approver_id varchar(50),
    approver_name_snapshot text,
    approval_level integer NOT NULL DEFAULT 1,
    action varchar(30) NOT NULL DEFAULT 'Pending' CHECK (
        action IN ('Pending', 'Approved', 'Rejected', 'Revision Requested')
    ),
    notes text,
    approved_at timestamptz,
    idempotency_key text,
    source_event_data jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_cash_account ON public.transactions(cash_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_branch_date ON public.transactions(branch_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_approvals_transaction ON public.approvals(transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_idempotency_key
    ON public.approvals(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.cashflow_enforce_approval_sod()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    transaction_owner text;
    transaction_requester text;
    actor_name text;
BEGIN
    IF NEW.action IN ('Approved', 'Rejected', 'Revision Requested') THEN
        actor_name := NULLIF(btrim(NEW.approver_name_snapshot), '');
        IF actor_name IS NULL THEN
            RAISE EXCEPTION 'An approval decision requires an approver identity.';
        END IF;

        SELECT created_by, requester
        INTO transaction_owner, transaction_requester
        FROM public.transactions
        WHERE id = NEW.transaction_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Approval transaction % does not exist.', NEW.transaction_id;
        END IF;

        IF lower(actor_name) = lower(btrim(COALESCE(transaction_owner, '')))
           OR lower(actor_name) = lower(btrim(COALESCE(transaction_requester, ''))) THEN
            RAISE EXCEPTION 'Segregation of duties violation: a requester/creator cannot decide their own transaction.';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashflow_enforce_approval_sod ON public.approvals;
CREATE TRIGGER cashflow_enforce_approval_sod
BEFORE INSERT ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.cashflow_enforce_approval_sod();

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_accounts, public.categories TO anon, authenticated;
REVOKE ALL ON public.branches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.transactions, public.approvals TO anon, authenticated;

DO $policies$
DECLARE
    policy_row record;
BEGIN
    FOR policy_row IN
        SELECT * FROM (VALUES
            ('cash_accounts', 'select'),
            ('cash_accounts', 'insert'),
            ('cash_accounts', 'update'),
            ('cash_accounts', 'delete'),
            ('categories', 'select'),
            ('categories', 'insert'),
            ('categories', 'update'),
            ('categories', 'delete'),
            ('transactions', 'select'),
            ('transactions', 'insert'),
            ('transactions', 'update'),
            ('approvals', 'select'),
            ('approvals', 'insert'),
            ('approvals', 'update')
        ) AS policies(table_name, command_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = policy_row.table_name
              AND policyname = 'cashflow_dev_' || policy_row.table_name || '_' || policy_row.command_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR %s TO anon, authenticated %s',
                'cashflow_dev_' || policy_row.table_name || '_' || policy_row.command_name,
                policy_row.table_name,
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

DROP POLICY IF EXISTS cashflow_dev_branches_select ON public.branches;
DROP POLICY IF EXISTS cashflow_dev_branches_insert ON public.branches;
DROP POLICY IF EXISTS cashflow_dev_branches_update ON public.branches;
DROP POLICY IF EXISTS cashflow_dev_branches_delete ON public.branches;
DROP POLICY IF EXISTS cashflow_branches_authenticated_read ON public.branches;
DROP POLICY IF EXISTS cashflow_branches_finance_manage ON public.branches;
CREATE POLICY cashflow_branches_authenticated_read ON public.branches
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY cashflow_branches_finance_manage ON public.branches
    FOR ALL TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager')
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'finance_manager');
