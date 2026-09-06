import {
  getConfigurationOverview,
  listPolicyTestInputs,
  listProducts,
  prisma,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { SettingsClient } from "./_components/settings-client";

/**
 * Screen 9 - Settings.
 *
 * A Server Component, like every other screen: `getConfigurationOverview` is
 * called directly rather than through the API route, so the capability check
 * happens before any markup exists and the first paint does not ask the server
 * for something the server was already holding.
 *
 * Decimals and Dates are turned into strings here. They do not survive the
 * server-to-client boundary, and money that has been through a JavaScript
 * number on the way to a form is money that can come back rounded.
 */
export default async function SettingsPage() {
  const user = await requireInternalUser("/settings");

  // AuthzUser carries only what authorisation needs - id, kind, role, scope -
  // so the display name for the account card is read from the record itself.
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true, email: true },
  });

  const actorCard = {
    name: actor.name,
    email: actor.email,
    role: user.role ?? "",
    initials: actor.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part[0] ?? "")
      .join("")
      .toUpperCase(),
  };

  /**
   * A Sales Rep holds `riskDetail` but not `report`, so the configuration
   * overview is genuinely not theirs to read - and the dock offers this screen
   * to everyone. Rather than letting the page throw, the one part that *is*
   * theirs is rendered: the policy tester, which answers "would this discount
   * need approval?" against the same rules their own deals go through.
   */
  let overview: Awaited<ReturnType<typeof getConfigurationOverview>>;
  try {
    overview = await getConfigurationOverview(user);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? (error as { status: number }).status
        : 0;
    if (status !== 403) throw error;

    const inputs = await listPolicyTestInputs(user);
    return (
      <SettingsClient
        data={{
          restricted: true,
          permissions: {
            discountTier: false,
            approvalChain: false,
            product: false,
            priceList: false,
            warehouse: false,
            subscriptionPlan: false,
            upsellRule: false,
          },
          actor: actorCard,
          categories: inputs.categories.map((c) => ({ ...c, productCount: 0 })),
          products: [],
          priceLists: [],
          tierCeilings: inputs.tiers.map((tier) => ({
            id: tier,
            tier,
            maxDiscount: "",
            isActive: true,
          })),
          categoryCeilings: [],
          approvalChains: [],
          warehouses: [],
          replenishment: [],
          plans: [],
          pairings: [],
          settings: [],
        }}
      />
    );
  }

  // Inactive products are exactly the ones an admin needs to see here, so the
  // catalogue is re-read without the active-only default the overview uses.
  const products = await listProducts({ activeOnly: false });

  return (
    <SettingsClient
      data={{
        restricted: false,
        permissions: overview.permissions,
        actor: actorCard,
        categories: overview.catalogue.categories.map((category) => ({
          id: category.id,
          name: category.name,
          productCount: category._count.products,
        })),
        products: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          categoryName: product.category.name,
          type: product.type,
          basePrice: product.basePrice.toFixed(2),
          costPrice: product.costPrice.toFixed(2),
          isActive: product.isActive,
          isPromoted: product.isPromoted,
        })),
        priceLists: overview.catalogue.priceLists.map((list) => ({
          id: list.id,
          name: list.name,
          tier: list.tier,
          currency: list.currency,
          isActive: list.isActive,
          itemCount: list.items.length,
        })),
        tierCeilings: overview.governance.tierDefaults.map((row) => ({
          id: row.id,
          tier: row.tier,
          maxDiscount: row.defaultMaxDiscount.toFixed(2),
          isActive: row.isActive,
        })),
        categoryCeilings: overview.governance.categoryOverrides.map((row) => ({
          id: row.id,
          tier: row.tier,
          categoryId: row.category.id,
          categoryName: row.category.name,
          maxDiscount: row.maxDiscount.toFixed(2),
        })),
        approvalChains: overview.governance.approvalChains.map((chain) => ({
          id: chain.id,
          name: chain.name,
          isActive: chain.isActive,
          steps: chain.steps.map((step) => ({
            id: step.id,
            stepOrder: step.stepOrder,
            approverRole: step.approverRole,
            minDiscount: step.minDiscount?.toFixed(2) ?? null,
            maxDiscount: step.maxDiscount?.toFixed(2) ?? null,
            minRiskScore: step.minRiskScore?.toFixed(2) ?? null,
            maxRiskScore: step.maxRiskScore?.toFixed(2) ?? null,
          })),
        })),
        warehouses: overview.operations.warehouses.map((warehouse) => ({
          id: warehouse.id,
          name: warehouse.name,
          code: warehouse.code,
          priority: warehouse.priority,
          shippingCost: warehouse.shippingCost,
          isActive: warehouse.isActive,
          skuCount: warehouse.stock.length,
          lowStockCount: warehouse.stock.filter((row) => row.needsReplenishment).length,
        })),
        replenishment: overview.operations.replenishment.map((row) => ({
          warehouseName: row.warehouseName,
          productName: row.productName,
          free: row.free,
          reorderLevel: row.reorderLevel,
          suggested: row.suggestedOrderQuantity,
        })),
        plans: overview.operations.plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          interval: plan.billingInterval,
          price: plan.price.toFixed(2),
          prorationRule: plan.prorationRule,
          cancellationRule: plan.cancellationRule,
          isActive: plan.isActive,
          subscriberCount: plan._count.subscriptions,
        })),
        pairings: overview.upsell.map((rule) => ({
          id: rule.id,
          baseProductName: rule.baseProduct.name,
          suggestedProductName: rule.suggestedProduct.name,
          derivedRate: rule.derivedRate,
          configuredRate: rule.configuredRate,
          effectiveRate: rule.effectiveRate,
          minMarginPercentage: rule.minMarginPercentage,
          isPromoted: rule.isPromoted,
        })),
        settings: overview.settings.map((setting) => ({
          key: setting.key,
          value: setting.value,
          description: setting.description,
          isDefault: setting.isDefault,
        })),
      }}
    />
  );
}
