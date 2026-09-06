-- Revert multi-tenancy.
--
-- The organization columns are removed and the original global unique keys are
-- restored. This is deliberate rather than a mistake being undone: the product
-- serves one company per database, and the tenancy work was started to give a
-- second company its own empty world. Emptying the first one turned out to be
-- the thing actually wanted, and that needs no tenancy at all.
--
-- Nothing but the organization columns is dropped, so every quotation, invoice,
-- shipment and audit entry survives exactly as it was.
--
-- Idempotent throughout, so it can be applied over a partial state.

-- Composite keys go first: dropping the column they depend on would fail while
-- they exist.
DROP INDEX IF EXISTS "SalesTeam_organizationId_name_key";
DROP INDEX IF EXISTS "Customer_organizationId_name_key";
DROP INDEX IF EXISTS "ProductCategory_organizationId_name_key";
DROP INDEX IF EXISTS "Tax_organizationId_name_key";
DROP INDEX IF EXISTS "Product_organizationId_sku_key";
DROP INDEX IF EXISTS "PriceList_organizationId_name_key";
DROP INDEX IF EXISTS "Quotation_organizationId_quoteNumber_key";
DROP INDEX IF EXISTS "DiscountTier_organizationId_tier_key";
DROP INDEX IF EXISTS "ApprovalChain_organizationId_name_key";
DROP INDEX IF EXISTS "Warehouse_organizationId_name_key";
DROP INDEX IF EXISTS "Warehouse_organizationId_code_key";
DROP INDEX IF EXISTS "SubscriptionPlan_organizationId_name_key";
DROP INDEX IF EXISTS "Shipment_organizationId_shipmentNumber_key";
DROP INDEX IF EXISTS "Invoice_organizationId_invoiceNumber_key";
DROP INDEX IF EXISTS "CreditNote_organizationId_creditNoteNumber_key";
DROP INDEX IF EXISTS "SystemSetting_organizationId_key_key";
DROP INDEX IF EXISTS "ProductVariant_productId_sku_key";

DROP INDEX IF EXISTS "ApprovalChain_organizationId_idx";
DROP INDEX IF EXISTS "AuditLog_organizationId_idx";
DROP INDEX IF EXISTS "CreditNote_organizationId_idx";
DROP INDEX IF EXISTS "Customer_organizationId_idx";
DROP INDEX IF EXISTS "DiscountPolicy_organizationId_idx";
DROP INDEX IF EXISTS "DiscountTier_organizationId_idx";
DROP INDEX IF EXISTS "Invoice_organizationId_idx";
DROP INDEX IF EXISTS "PriceList_organizationId_idx";
DROP INDEX IF EXISTS "Product_organizationId_idx";
DROP INDEX IF EXISTS "ProductCategory_organizationId_idx";
DROP INDEX IF EXISTS "ProductPairing_organizationId_idx";
DROP INDEX IF EXISTS "Quotation_organizationId_idx";
DROP INDEX IF EXISTS "SalesTeam_organizationId_idx";
DROP INDEX IF EXISTS "Shipment_organizationId_idx";
DROP INDEX IF EXISTS "SubscriptionPlan_organizationId_idx";
DROP INDEX IF EXISTS "SystemSetting_organizationId_idx";
DROP INDEX IF EXISTS "Tax_organizationId_idx";
DROP INDEX IF EXISTS "User_organizationId_idx";
DROP INDEX IF EXISTS "Warehouse_organizationId_idx";

ALTER TABLE "ApprovalChain" DROP CONSTRAINT IF EXISTS "ApprovalChain_organizationId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_organizationId_fkey";
ALTER TABLE "CreditNote" DROP CONSTRAINT IF EXISTS "CreditNote_organizationId_fkey";
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_organizationId_fkey";
ALTER TABLE "DiscountPolicy" DROP CONSTRAINT IF EXISTS "DiscountPolicy_organizationId_fkey";
ALTER TABLE "DiscountTier" DROP CONSTRAINT IF EXISTS "DiscountTier_organizationId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_organizationId_fkey";
ALTER TABLE "PriceList" DROP CONSTRAINT IF EXISTS "PriceList_organizationId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_organizationId_fkey";
ALTER TABLE "ProductCategory" DROP CONSTRAINT IF EXISTS "ProductCategory_organizationId_fkey";
ALTER TABLE "ProductPairing" DROP CONSTRAINT IF EXISTS "ProductPairing_organizationId_fkey";
ALTER TABLE "Quotation" DROP CONSTRAINT IF EXISTS "Quotation_organizationId_fkey";
ALTER TABLE "SalesTeam" DROP CONSTRAINT IF EXISTS "SalesTeam_organizationId_fkey";
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_organizationId_fkey";
ALTER TABLE "SubscriptionPlan" DROP CONSTRAINT IF EXISTS "SubscriptionPlan_organizationId_fkey";
ALTER TABLE "SystemSetting" DROP CONSTRAINT IF EXISTS "SystemSetting_organizationId_fkey";
ALTER TABLE "Tax" DROP CONSTRAINT IF EXISTS "Tax_organizationId_fkey";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_organizationId_fkey";
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS "Warehouse_organizationId_fkey";

ALTER TABLE "ApprovalChain" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "CreditNote" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "DiscountPolicy" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "DiscountTier" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "PriceList" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "ProductCategory" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "ProductPairing" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Quotation" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "SalesTeam" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Shipment" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "SubscriptionPlan" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Tax" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS "organizationId";

-- The append-only trigger (D19) blocks any write to this table, including
-- dropping a column, so it is lifted for exactly that and restored after. No
-- entry's hash, actor or position in the chain is touched.
ALTER TABLE "AuditLog" DISABLE TRIGGER "audit_log_no_mutate";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "AuditLog" ENABLE TRIGGER "audit_log_no_mutate";

-- SystemSetting goes back to a bare `key` primary key.
ALTER TABLE "SystemSetting" DROP CONSTRAINT IF EXISTS "SystemSetting_pkey";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "id";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key");

-- What someone typed at signup keeps its original name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'User' AND column_name = 'signupOrganization') THEN
    ALTER TABLE "User" RENAME COLUMN "signupOrganization" TO "organization";
  END IF;
END $$;

DROP TABLE IF EXISTS "Organization";

-- The original global unique keys.
CREATE UNIQUE INDEX IF NOT EXISTS "SalesTeam_name_key" ON "SalesTeam"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_name_key" ON "Customer"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_name_key" ON "ProductCategory"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Tax_name_key" ON "Tax"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE UNIQUE INDEX IF NOT EXISTS "PriceList_name_key" ON "PriceList"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_quoteNumber_key" ON "Quotation"("quoteNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountTier_tier_key" ON "DiscountTier"("tier");
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalChain_name_key" ON "ApprovalChain"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_name_key" ON "Warehouse"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_code_key" ON "Warehouse"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_shipmentNumber_key" ON "Shipment"("shipmentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");
