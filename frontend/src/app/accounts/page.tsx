import { can, listAccounts, listAssignableOwners } from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { AccountsClient } from "./_components/accounts-client";

/**
 * Screen 8 - Customer Accounts & Portal Access.
 *
 * A Server Component, like the other screens: the capability check happens
 * before any markup exists, so nobody receives a table shell that then empties
 * itself. Both loaders take the user, and both scope inside the service rather
 * than filtering what they hand back.
 */
export default async function AccountsPage() {
  const user = await requireInternalUser("/accounts");

  const [rows, owners] = await Promise.all([listAccounts(user), listAssignableOwners(user)]);

  return (
    <AccountsClient data={{ rows, owners, canCreate: can(user, "create") }} />
  );
}
