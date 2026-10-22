import { redirect } from "next/navigation";
import { agencyOwner } from "@/lib/customer-portal/auth";
import DemoManager from "./DemoManager";
export default async function Page() {
  try {
    await agencyOwner();
  } catch {
    redirect("/login");
  }
  return <DemoManager />;
}
