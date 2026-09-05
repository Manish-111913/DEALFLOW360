import { Prisma } from "../generated/prisma/client";
import type { CustomerTier } from "../generated/prisma/enums";
import { NotFoundError } from "../errors";
import { prisma } from "../db";

/**
 * Catalogue reads and price resolution.
 *
 * §A2 asks for tier-based price lists. Note this is a different mechanism from
 * the tier-based discount ceilings in §A3: this decides what a customer is
 * charged, that decides how far a rep may discount it. Both key off the same
 * customer tier, which is why they are easy to confuse.
 */

const ZERO = new Prisma.Decimal(0);

export type PriceSource = "PRICE_LIST" | "BASE_PRICE";

/**
 * D22 — the resolved price carries its own derivation, so a screen can show
 * why a number is what it is instead of asserting it.
 */
export interface PriceResolution {
  unitPrice: Prisma.Decimal;
  source: PriceSource;
  basePrice: Prisma.Decimal;
  variantExtra: Prisma.Decimal;
  priceListName: string | null;
  steps: string[];
}

export interface ResolvePriceInput {
  productId: string;
  variantId?: string | null;
  tier: CustomerTier | null;
  quantity?: number;
}

/**
 * Resolution order: a matching tier price-list item for this quantity band,
 * else the product's base price. The variant's extra price is then added in
 * either case.
 *
 * The fallback matters as much as the hit — most products carry no tier price,
 * and silently returning zero for them would corrupt every margin downstream.
 */
export async function resolveUnitPrice(input: ResolvePriceInput): Promise<PriceResolution> {
  const quantity = input.quantity ?? 1;

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true, basePrice: true },
  });
  if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);

  let variantExtra = ZERO;
  if (input.variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { productId: true, extraPrice: true, attributeName: true, attributeValue: true },
    });
    if (!variant) throw new NotFoundError(`Variant ${input.variantId} does not exist`);
    if (variant.productId !== product.id) {
      throw new NotFoundError(
        `Variant ${input.variantId} does not belong to product ${product.id}`,
      );
    }
    variantExtra = variant.extraPrice;
  }

  const steps: string[] = [];
  let base = product.basePrice;
  let source: PriceSource = "BASE_PRICE";
  let priceListName: string | null = null;

  if (input.tier) {
    // Two levels of specificity. A row naming this variant wins; otherwise a
    // product-level row (variantId null) applies to every variant, with the
    // variant's extra added on top. Requiring an exact variant match would make
    // product-level pricing silently invisible whenever a variant is chosen.
    const findItem = (variantId: string | null) =>
      prisma.priceListItem.findFirst({
        where: {
          productId: product.id,
          variantId,
          minQuantity: { lte: quantity },
          OR: [{ maxQuantity: null }, { maxQuantity: { gte: quantity } }],
          priceList: { tier: input.tier, isActive: true },
        },
        // Most specific band first: the highest minQuantity that still applies.
        orderBy: { minQuantity: "desc" },
        include: { priceList: { select: { name: true } } },
      });

    const item =
      (input.variantId ? await findItem(input.variantId) : null) ?? (await findItem(null));

    if (item) {
      base = item.price;
      source = "PRICE_LIST";
      priceListName = item.priceList.name;
      steps.push(
        `${input.tier} price list "${item.priceList.name}" sets ${product.name} at ${base.toFixed(2)} for qty >= ${item.minQuantity}`,
      );
    }
  }

  if (source === "BASE_PRICE") {
    steps.push(
      input.tier
        ? `No ${input.tier} price-list entry for ${product.name}; using base price ${base.toFixed(2)}`
        : `Customer has no tier; using base price ${base.toFixed(2)}`,
    );
  }

  if (!variantExtra.isZero()) {
    steps.push(`Variant adds ${variantExtra.toFixed(2)}`);
  }

  const unitPrice = base.add(variantExtra);
  steps.push(`Unit price = ${unitPrice.toFixed(2)}`);

  return { unitPrice, source, basePrice: base, variantExtra, priceListName, steps };
}

/** Catalogue listing for the quotation builder's product picker. */
export async function listCatalog(options?: { categoryId?: string; activeOnly?: boolean }) {
  return prisma.product.findMany({
    where: {
      ...(options?.categoryId ? { categoryId: options.categoryId } : {}),
      ...(options?.activeOnly === false ? {} : { isActive: true }),
    },
    include: {
      category: { select: { id: true, name: true } },
      tax: { select: { id: true, name: true, percentage: true } },
      variants: { where: { isActive: true }, orderBy: { attributeValue: "asc" } },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
}
