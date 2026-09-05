-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('NONE', 'PENDING_MANAGER', 'PENDING_FINANCE', 'APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PortalStatus" AS ENUM ('NOT_SHARED', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "RiskFactorSource" AS ENUM ('CATEGORY_VIOLATION', 'DEVIATION_BREADTH', 'MARGIN_EXPOSURE', 'REPEATED_NEGOTIATION', 'DELIVERY_RISK');

-- CreateEnum
CREATE TYPE "UpsellStatus" AS ENUM ('SUGGESTED', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FulfillmentPlanStatus" AS ENUM ('RECOMMENDED', 'ALTERNATIVE', 'ACCEPTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('RESERVED', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BackorderStatus" AS ENUM ('OPEN', 'CONSOLIDATED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingScheduleStatus" AS ENUM ('SCHEDULED', 'INVOICED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'APPLIED');

-- CreateEnum
CREATE TYPE "NegotiationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NegotiationRequestType" AS ENUM ('COUNTER_DISCOUNT', 'QUANTITY_CHANGE', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "NegotiationRequestStatus" AS ENUM ('SUBMITTED', 'ACCEPTED_NO_REAPPROVAL', 'ACCEPTED_PENDING_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "DealSeverity" AS ENUM ('HEALTHY', 'WATCH', 'AT_RISK', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('STALLED', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE', 'APPROVAL_DELAY');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'CONFIRM';
ALTER TYPE "AuditAction" ADD VALUE 'INVOICE';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_NOTE';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "assignedSalesRepId" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tax" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Tax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "basePrice" DECIMAL(14,2) NOT NULL,
    "costPrice" DECIMAL(14,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "taxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPromoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "attributeValue" TEXT NOT NULL,
    "extraPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "CustomerTier",
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalState" "ApprovalState" NOT NULL DEFAULT 'NONE',
    "portalStatus" "PortalStatus" NOT NULL DEFAULT 'NOT_SHARED',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossMargin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marginPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "riskScore" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "negotiationCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "lineSubtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marginAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marginPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountCeiling" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "violationPoints" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isUpsell" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationVersion" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "createdById" TEXT,
    "reason" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "grossMargin" DECIMAL(14,2) NOT NULL,
    "marginPercentage" DECIMAL(5,2) NOT NULL,
    "riskScore" DECIMAL(5,2) NOT NULL,
    "lineSnapshot" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountTier" (
    "id" TEXT NOT NULL,
    "tier" "CustomerTier" NOT NULL,
    "defaultMaxDiscount" DECIMAL(5,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountPolicy" (
    "id" TEXT NOT NULL,
    "tier" "CustomerTier" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "maxDiscount" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalChain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalChainId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverRole" "Role" NOT NULL,
    "minRiskScore" DECIMAL(5,2),
    "maxRiskScore" DECIMAL(5,2),
    "minDiscount" DECIMAL(5,2),
    "maxDiscount" DECIMAL(5,2),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "riskScore" DECIMAL(5,2) NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFactor" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "source" "RiskFactorSource" NOT NULL,
    "points" DECIMAL(5,2) NOT NULL,
    "description" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPairing" (
    "id" TEXT NOT NULL,
    "baseProductId" TEXT NOT NULL,
    "suggestedProductId" TEXT NOT NULL,
    "coPurchaseRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "configuredRate" DECIMAL(5,4),
    "minMarginPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellRecommendation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "marginDelta" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "UpsellStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "UpsellRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentPlan" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "status" "FulfillmentPlanStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "estimatedShipmentCount" INTEGER NOT NULL,
    "estimatedShippingCost" DECIMAL(14,2) NOT NULL,
    "isRunnerUp" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "stockSnapshotAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentPlanLine" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "quotationLineId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "FulfillmentPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentAllocation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "quotationLineId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "backorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "AllocationStatus" NOT NULL DEFAULT 'RESERVED',
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shippingCost" DECIMAL(14,2) NOT NULL,
    "estimatedDeliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backorder" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "quotationLineId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "BackorderStatus" NOT NULL DEFAULT 'OPEN',
    "expectedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backorder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "billingInterval" "BillingInterval" NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "prorationRule" TEXT NOT NULL DEFAULT 'DAILY_CALENDAR',
    "cancellationRule" TEXT NOT NULL DEFAULT 'PRORATA_CREDIT',
    "refundRule" TEXT NOT NULL DEFAULT 'NO_REFUND_FOR_CONSUMED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "quotationLineId" TEXT,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currentPrice" DECIMAL(14,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSchedule" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "billingDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "BillingScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "prorationNote" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "quotationLineId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "invoiceId" TEXT,
    "subscriptionId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Negotiation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "NegotiationStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Negotiation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationRequest" (
    "id" TEXT NOT NULL,
    "negotiationId" TEXT NOT NULL,
    "quotationLineId" TEXT,
    "requestType" "NegotiationRequestType" NOT NULL,
    "requestedValue" DECIMAL(14,2),
    "reason" TEXT,
    "status" "NegotiationRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "NegotiationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationComment" (
    "id" TEXT NOT NULL,
    "negotiationId" TEXT NOT NULL,
    "quotationLineId" TEXT,
    "authorId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealHealthSnapshot" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "riskScore" DECIMAL(5,2) NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "severity" "DealSeverity" NOT NULL,
    "stalledPenalty" INTEGER NOT NULL DEFAULT 0,
    "approvalDelayPenalty" INTEGER NOT NULL DEFAULT 0,
    "negotiationPenalty" INTEGER NOT NULL DEFAULT 0,
    "deliveryPenalty" INTEGER NOT NULL DEFAULT 0,
    "discountAnomalyPenalty" INTEGER NOT NULL DEFAULT 0,
    "stalledDays" INTEGER NOT NULL DEFAULT 0,
    "negotiationCount" INTEGER NOT NULL DEFAULT 0,
    "recommendedAction" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealAlert" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "DealSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DealAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tax_name_key" ON "Tax"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_type_idx" ON "Product"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_name_key" ON "PriceList"("name");

-- CreateIndex
CREATE INDEX "PriceList_tier_idx" ON "PriceList"("tier");

-- CreateIndex
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_variantId_minQuantity_key" ON "PriceListItem"("priceListId", "productId", "variantId", "minQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quoteNumber_key" ON "Quotation"("quoteNumber");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_salesRepId_idx" ON "Quotation"("salesRepId");

-- CreateIndex
CREATE INDEX "Quotation_approvalState_idx" ON "Quotation"("approvalState");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_lastActivityAt_idx" ON "Quotation"("lastActivityAt");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLine_productId_idx" ON "QuotationLine"("productId");

-- CreateIndex
CREATE INDEX "QuotationVersion_quotationId_approvedAt_idx" ON "QuotationVersion"("quotationId", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationVersion_quotationId_versionNumber_key" ON "QuotationVersion"("quotationId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountTier_tier_key" ON "DiscountTier"("tier");

-- CreateIndex
CREATE INDEX "DiscountPolicy_tier_categoryId_idx" ON "DiscountPolicy"("tier", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalChain_name_key" ON "ApprovalChain"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_approvalChainId_stepOrder_key" ON "ApprovalStep"("approvalChainId", "stepOrder");

-- CreateIndex
CREATE INDEX "ApprovalRequest_quotationId_idx" ON "ApprovalRequest"("quotationId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_assignedToId_idx" ON "ApprovalRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "RiskFactor_quotationId_idx" ON "RiskFactor"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPairing_baseProductId_suggestedProductId_key" ON "ProductPairing"("baseProductId", "suggestedProductId");

-- CreateIndex
CREATE INDEX "UpsellRecommendation_quotationId_idx" ON "UpsellRecommendation"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_name_key" ON "Warehouse"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "WarehouseStock_productId_idx" ON "WarehouseStock"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStock_warehouseId_productId_variantId_key" ON "WarehouseStock"("warehouseId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "FulfillmentPlan_quotationId_idx" ON "FulfillmentPlan"("quotationId");

-- CreateIndex
CREATE INDEX "FulfillmentPlanLine_planId_idx" ON "FulfillmentPlanLine"("planId");

-- CreateIndex
CREATE INDEX "FulfillmentAllocation_quotationId_idx" ON "FulfillmentAllocation"("quotationId");

-- CreateIndex
CREATE INDEX "FulfillmentAllocation_warehouseId_idx" ON "FulfillmentAllocation"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNumber_key" ON "Shipment"("shipmentNumber");

-- CreateIndex
CREATE INDEX "Shipment_quotationId_idx" ON "Shipment"("quotationId");

-- CreateIndex
CREATE INDEX "Backorder_quotationId_idx" ON "Backorder"("quotationId");

-- CreateIndex
CREATE INDEX "Backorder_status_idx" ON "Backorder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");

-- CreateIndex
CREATE INDEX "Subscription_quotationId_idx" ON "Subscription"("quotationId");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

-- CreateIndex
CREATE INDEX "Subscription_nextBillingDate_idx" ON "Subscription"("nextBillingDate");

-- CreateIndex
CREATE INDEX "BillingSchedule_subscriptionId_idx" ON "BillingSchedule"("subscriptionId");

-- CreateIndex
CREATE INDEX "BillingSchedule_billingDate_status_idx" ON "BillingSchedule"("billingDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_quotationId_idx" ON "Invoice"("quotationId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_subscriptionId_idx" ON "CreditNote"("subscriptionId");

-- CreateIndex
CREATE INDEX "Negotiation_quotationId_idx" ON "Negotiation"("quotationId");

-- CreateIndex
CREATE INDEX "NegotiationRequest_negotiationId_idx" ON "NegotiationRequest"("negotiationId");

-- CreateIndex
CREATE INDEX "NegotiationComment_negotiationId_idx" ON "NegotiationComment"("negotiationId");

-- CreateIndex
CREATE INDEX "DealHealthSnapshot_quotationId_computedAt_idx" ON "DealHealthSnapshot"("quotationId", "computedAt");

-- CreateIndex
CREATE INDEX "DealAlert_quotationId_idx" ON "DealAlert"("quotationId");

-- CreateIndex
CREATE INDEX "DealAlert_status_idx" ON "DealAlert"("status");

-- CreateIndex
CREATE INDEX "Customer_tier_idx" ON "Customer"("tier");

-- CreateIndex
CREATE INDEX "Customer_assignedSalesRepId_idx" ON "Customer"("assignedSalesRepId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_assignedSalesRepId_fkey" FOREIGN KEY ("assignedSalesRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxId_fkey" FOREIGN KEY ("taxId") REFERENCES "Tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationVersion" ADD CONSTRAINT "QuotationVersion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationVersion" ADD CONSTRAINT "QuotationVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountPolicy" ADD CONSTRAINT "DiscountPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalChainId_fkey" FOREIGN KEY ("approvalChainId") REFERENCES "ApprovalChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFactor" ADD CONSTRAINT "RiskFactor_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPairing" ADD CONSTRAINT "ProductPairing_baseProductId_fkey" FOREIGN KEY ("baseProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPairing" ADD CONSTRAINT "ProductPairing_suggestedProductId_fkey" FOREIGN KEY ("suggestedProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRecommendation" ADD CONSTRAINT "UpsellRecommendation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRecommendation" ADD CONSTRAINT "UpsellRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlan" ADD CONSTRAINT "FulfillmentPlan_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanLine" ADD CONSTRAINT "FulfillmentPlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FulfillmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentAllocation" ADD CONSTRAINT "FulfillmentAllocation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentAllocation" ADD CONSTRAINT "FulfillmentAllocation_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentAllocation" ADD CONSTRAINT "FulfillmentAllocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSchedule" ADD CONSTRAINT "BillingSchedule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSchedule" ADD CONSTRAINT "BillingSchedule_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Negotiation" ADD CONSTRAINT "Negotiation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Negotiation" ADD CONSTRAINT "Negotiation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationRequest" ADD CONSTRAINT "NegotiationRequest_negotiationId_fkey" FOREIGN KEY ("negotiationId") REFERENCES "Negotiation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationRequest" ADD CONSTRAINT "NegotiationRequest_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationComment" ADD CONSTRAINT "NegotiationComment_negotiationId_fkey" FOREIGN KEY ("negotiationId") REFERENCES "Negotiation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationComment" ADD CONSTRAINT "NegotiationComment_quotationLineId_fkey" FOREIGN KEY ("quotationLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationComment" ADD CONSTRAINT "NegotiationComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealHealthSnapshot" ADD CONSTRAINT "DealHealthSnapshot_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealAlert" ADD CONSTRAINT "DealAlert_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- D12: one ACTIVE policy per (tier, category), while keeping deactivated rows
-- for history. A plain unique key would make the documented
-- deactivate-then-replace workflow impossible, because the old row keeps the key.
CREATE UNIQUE INDEX "DiscountPolicy_active_tier_category_key"
  ON "DiscountPolicy" ("tier", "categoryId")
  WHERE "isActive" = true;

-- Quantities are counts, not signed numbers. Catching this at the storage layer
-- means the margin and allocation engines never have to defend against it.
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_quantities_non_negative"
  CHECK ("availableQuantity" >= 0 AND "reservedQuantity" >= 0);

-- Discounts are percentages. A line at 120% would produce negative revenue and
-- a nonsensical risk score.
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_discount_percentage_range"
  CHECK ("discountPercentage" >= 0 AND "discountPercentage" <= 100);
