import { notFound, redirect } from "next/navigation";
import type { Permission } from "../access/policy";
import { customerAccess } from "./auth";
import { PortalError } from "./input";
export async function customerPageAccess(
  id: string,
  permission: Permission = "support.read",
) {
  try {
    return await customerAccess(id, permission);
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      redirect("/customer/login");
    notFound();
  }
}
