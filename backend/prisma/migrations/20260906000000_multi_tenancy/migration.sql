-- Multi-tenancy.
--
-- Every company-owned row gains an organizationId. This migration BACKFILLS
-- rather than starting from an empty database: the demo data already here is
-- real, and dropping it just to add a column would be a poor trade. So each
-- column arrives nullable, every existing row is claimed by one default
-- organization, and only then does the column become NOT NULL.
--
-- That default organization is the company all the existing data belonged to
-- implicitly, back when there was no way to say so.
--
-- Every statement is idempotent, so a partially-applied run can simply be
-- applied again instead of needing the database rebuilt.

CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_name_key" ON "Organization"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");

INSERT INTO "Organization" ("id", "name", "slug", "isActive", "createdAt", "updatedAt")
VALUES ('org_dealflow_demo', 'DealFlow Demo Co', 'demo', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- What someone typed at signup survives: renamed, not dropped, because it was
-- never the tenant - it is what they told us about themselves.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'User' AND column_name = 'organization') THEN
    ALTER TABLE "User" RENAME COLUMN "organization" TO "signupOrganization";
  END IF;
END $$;


ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "ApprovalChain" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "ApprovalChain" ALTER COLUMN "organizationId" SET NOT NULL;

-- The append-only trigger (D19) refuses UPDATE on this table, and it is right
-- to: nothing in the application may ever rewrite an audit row. Backfilling a
-- new column is schema evolution rather than tampering, so the trigger is lifted
-- for exactly this statement and restored immediately after. Every entry keeps
-- its hash, its actor and its place in the chain.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AuditLog" DISABLE TRIGGER "audit_log_no_mutate";
UPDATE "AuditLog" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "AuditLog" ENABLE TRIGGER "audit_log_no_mutate";
ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "CreditNote" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Customer" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "DiscountPolicy" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "DiscountPolicy" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "DiscountPolicy" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "DiscountTier" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "DiscountTier" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "DiscountTier" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Invoice" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "PriceList" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "PriceList" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "PriceList" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Product" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "ProductCategory" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "ProductCategory" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "ProductCategory" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "ProductPairing" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "ProductPairing" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "ProductPairing" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Quotation" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Quotation" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "SalesTeam" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "SalesTeam" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "SalesTeam" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Shipment" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Shipment" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "SubscriptionPlan" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Tax" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Tax" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Tax" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "User" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "Warehouse" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "Warehouse" ALTER COLUMN "organizationId" SET NOT NULL;

-- SystemSetting also swaps its primary key. It was the bare `key`, so the whole
-- installation could hold exactly one value per setting - one currency, one
-- target margin, for every company at once.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "SystemSetting" SET "organizationId" = 'org_dealflow_demo' WHERE "organizationId" IS NULL;
ALTER TABLE "SystemSetting" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "id" TEXT;
UPDATE "SystemSetting" SET "id" = md5(random()::text || "key") WHERE "id" IS NULL;
ALTER TABLE "SystemSetting" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "SystemSetting" DROP CONSTRAINT IF EXISTS "SystemSetting_pkey";
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id");

-- DropIndex
DROP INDEX IF EXISTS "ApprovalChain_name_key";

-- DropIndex
DROP INDEX IF EXISTS "CreditNote_creditNoteNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "Customer_name_key";

-- DropIndex
DROP INDEX IF EXISTS "DiscountTier_tier_key";

-- DropIndex
DROP INDEX IF EXISTS "Invoice_invoiceNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "PriceList_name_key";

-- DropIndex
DROP INDEX IF EXISTS "Product_sku_key";

-- DropIndex
DROP INDEX IF EXISTS "ProductCategory_name_key";

-- DropIndex
DROP INDEX IF EXISTS "ProductVariant_sku_key";

-- DropIndex
DROP INDEX IF EXISTS "Quotation_quoteNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "SalesTeam_name_key";

-- DropIndex
DROP INDEX IF EXISTS "Shipment_shipmentNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "SubscriptionPlan_name_key";

-- DropIndex
DROP INDEX IF EXISTS "Tax_name_key";

-- DropIndex
DROP INDEX IF EXISTS "Warehouse_code_key";

-- DropIndex
DROP INDEX IF EXISTS "Warehouse_name_key";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalChain_organizationId_idx" ON "ApprovalChain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalChain_organizationId_name_key" ON "ApprovalChain"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditNote_organizationId_idx" ON "CreditNote"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_organizationId_creditNoteNumber_key" ON "CreditNote"("organizationId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_organizationId_idx" ON "Customer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_organizationId_name_key" ON "Customer"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountPolicy_organizationId_idx" ON "DiscountPolicy"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountTier_organizationId_idx" ON "DiscountTier"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountTier_organizationId_tier_key" ON "DiscountTier"("organizationId", "tier");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PriceList_organizationId_idx" ON "PriceList"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PriceList_organizationId_name_key" ON "PriceList"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_organizationId_idx" ON "Product"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductCategory_organizationId_idx" ON "ProductCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_organizationId_name_key" ON "ProductCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductPairing_organizationId_idx" ON "ProductPairing"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quotation_organizationId_idx" ON "Quotation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_organizationId_quoteNumber_key" ON "Quotation"("organizationId", "quoteNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalesTeam_organizationId_idx" ON "SalesTeam"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SalesTeam_organizationId_name_key" ON "SalesTeam"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Shipment_organizationId_idx" ON "Shipment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_organizationId_shipmentNumber_key" ON "Shipment"("organizationId", "shipmentNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_organizationId_idx" ON "SubscriptionPlan"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_organizationId_name_key" ON "SubscriptionPlan"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SystemSetting_organizationId_idx" ON "SystemSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SystemSetting_organizationId_key_key" ON "SystemSetting"("organizationId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tax_organizationId_idx" ON "Tax"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tax_organizationId_name_key" ON "Tax"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Warehouse_organizationId_idx" ON "Warehouse"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_organizationId_name_key" ON "Warehouse"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tax" ADD CONSTRAINT "Tax_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountTier" ADD CONSTRAINT "DiscountTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountPolicy" ADD CONSTRAINT "DiscountPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalChain" ADD CONSTRAINT "ApprovalChain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPairing" ADD CONSTRAINT "ProductPairing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
