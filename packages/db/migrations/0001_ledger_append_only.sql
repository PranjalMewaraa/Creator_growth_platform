-- Invariant 6: the credit ledger is append only. Enforced here so no code path can edit history.
-- A correction is a new entry, never an UPDATE or DELETE.
CREATE FUNCTION credit_ledger_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_forbid_mutation();
