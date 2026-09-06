import { NextResponse } from "next/server";
import { addApprovalStep, removeApprovalStep, setApprovalStep } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/** The only role that reviews a deal here; the routing engine looks up a
 *  holder, and Finance/Operations is not staffed in this company. */
const APPROVER_ROLES = ["SALES_MANAGER"] as const;
type ApproverRole = (typeof APPROVER_ROLES)[number];

/**
 * The approval chain (D11) - who reviews a deal, and at what discount.
 *
 * The sharpest control in the application: widening a band means quotations
 * that would have needed a reviewer now go straight to the customer. Every
 * write here is audited for exactly that reason.
 */
export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { stepId, minDiscount, maxDiscount, minRiskScore, maxRiskScore } =
      (payload as Record<string, unknown>) ?? {};

    if (typeof stepId !== "string" || !stepId) return badRequest("stepId is required");

    // null clears a bound (making that side unbounded); undefined leaves it be.
    const bound = (value: unknown, name: string) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      if (typeof value !== "string") throw Object.assign(new Error(`${name} must be a string`), { status: 400 });
      return value;
    };

    const updated = await setApprovalStep(user, {
      stepId,
      minDiscount: bound(minDiscount, "minDiscount"),
      maxDiscount: bound(maxDiscount, "maxDiscount"),
      minRiskScore: bound(minRiskScore, "minRiskScore"),
      maxRiskScore: bound(maxRiskScore, "maxRiskScore"),
    });

    return NextResponse.json({ id: updated.id });
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { chainId, approverRole, minDiscount } = (payload as Record<string, unknown>) ?? {};

    if (typeof chainId !== "string" || !chainId) return badRequest("chainId is required");
    if (!APPROVER_ROLES.includes(approverRole as ApproverRole)) {
      return badRequest(`approverRole must be one of ${APPROVER_ROLES.join(", ")}`);
    }

    const step = await addApprovalStep(user, {
      chainId,
      approverRole: approverRole as ApproverRole,
      minDiscount: typeof minDiscount === "string" && minDiscount ? minDiscount : null,
    });

    return NextResponse.json({ id: step.id, stepOrder: step.stepOrder });
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const stepId = new URL(request.url).searchParams.get("stepId");
    if (!stepId) return badRequest("stepId is required");

    await removeApprovalStep(user, stepId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
