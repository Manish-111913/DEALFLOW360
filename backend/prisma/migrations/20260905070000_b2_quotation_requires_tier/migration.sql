-- A quotation cannot exist for a customer with no tier.
--
-- The service layer raises a ValidationError naming the field, which is what
-- gives a usable message. This is the backstop: without a tier there is no
-- discount ceiling to check lines against, so every governance rule downstream
-- would pass vacuously — the quote would look compliant precisely because
-- nothing was checked. That is worth refusing at the storage layer, not only in
-- the code path that happens to be in front of it today.

CREATE OR REPLACE FUNCTION dealflow_quotation_requires_customer_tier() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  customer_tier text;
  customer_name text;
BEGIN
  SELECT "tier"::text, "name"
    INTO customer_tier, customer_name
    FROM "Customer"
   WHERE "id" = NEW."customerId";

  IF customer_tier IS NULL THEN
    RAISE EXCEPTION
      'Customer "%" has no tier set; a quotation cannot be created without one (field: tier)',
      COALESCE(customer_name, NEW."customerId");
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER quotation_requires_customer_tier
  BEFORE INSERT OR UPDATE OF "customerId" ON "Quotation"
  FOR EACH ROW EXECUTE FUNCTION dealflow_quotation_requires_customer_tier();
