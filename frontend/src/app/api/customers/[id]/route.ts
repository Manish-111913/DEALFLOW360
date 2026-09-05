import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth";
import { readCustomer } from "@dealflow/backend";
import { forbidden, notFound, unauthorized } from "@/lib/http";

// Next 16: route params are async.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const result = await readCustomer(user, id);

  switch (result.status) {
    case 200:
      return NextResponse.json(result.customer);
    case 401:
      return unauthorized();
    case 404:
      return notFound();
    default:
      return forbidden("This record belongs to another customer");
  }
}
