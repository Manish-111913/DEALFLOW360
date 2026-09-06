import { NextResponse } from "next/server";
import { issuePortalLinkAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";
import { portalBaseUrl } from "@/lib/surface";

/**
 * Mint a single-use sign-in link for this account's portal contacts.
 *
 * The raw token is returned exactly once and never stored - the database keeps
 * only its hash - so a caller that loses this response has to issue a new link
 * rather than look the old one up. That is what makes a leaked database row
 * useless as a credential.
 *
 * The portal's origin comes from the request rather than from a constant,
 * because the internal workspace and the portal are two processes and only the
 * deployment knows where the second one answers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    const link = await issuePortalLinkAs(user, id, portalBaseUrl(new URL(request.url).origin));
    return NextResponse.json(link);
  } catch (error) {
    return handleServiceError(error);
  }
}
