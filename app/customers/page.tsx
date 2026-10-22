import { redirect } from "next/navigation";
import { getTenantId } from "@/lib/auth";
import Customers from "./Customers";
import "@/app/customer/portal.css";
export default async function CustomersPage() {
  if (!(await getTenantId())) redirect("/login");
  return <Customers portalOrigin={process.env.CUSTOMER_PORTAL_ORIGIN || ""} />;
}
