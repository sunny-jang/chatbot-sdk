import { portalUser } from "@/lib/customer-portal/auth";
import { redirect } from "next/navigation";
import { getTenantId } from "@/lib/auth";
import SupportInbox from "./SupportInbox";
import { queryValue } from "@/lib/workspace-inbox";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{
    session?: string | string[];
    status?: string | string[];
  }>;
}) {
  if (!(await getTenantId())) redirect("/login");
  const user = await portalUser();
  const params = await searchParams;
  const requestedStatus = queryValue(params.status);
  const status = ["waiting", "active", "closed"].includes(requestedStatus)
    ? requestedStatus
    : "waiting";
  const session = queryValue(params.session).slice(0, 200);
  return (
    <SupportInbox
      key={`${session}:${status}`}
      portalUserId={user.id}
      canReassign
      initialSession={session}
      initialStatus={status}
    />
  );
}
