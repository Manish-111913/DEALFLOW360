import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/navigation";

/** `/my` on its own is not a screen; the customer's home is their quotations. */
export default function MyRootPage() {
  redirect(ROUTES.customerHome);
}
