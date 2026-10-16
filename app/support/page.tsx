import { redirect } from "next/navigation";
import { getTenantId } from "@/lib/auth";
import SupportInbox from "./SupportInbox";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; status?: string }>;
}) {
  if (!(await getTenantId())) redirect("/login");
  const params = await searchParams;
  const status = ["waiting", "active", "closed"].includes(params.status || "")
    ? params.status!
    : "waiting";
  return (
    <SupportInbox
      key={`${params.session || ""}:${status}`}
      initialSession={params.session || ""}
      initialStatus={status}
    />
  );
}
