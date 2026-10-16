import { redirect } from "next/navigation";
import { getTenantId } from "@/lib/auth";
import SupportInbox from "./SupportInbox";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  if (!(await getTenantId())) redirect("/login");
  const params = await searchParams;
  return <SupportInbox initialSession={params.session || ""} />;
}
