import { customerPageAccess } from "@/lib/customer-portal/page";
import SupportInbox from "@/app/support/SupportInbox";
import { queryValue } from "@/lib/workspace-inbox";
export default async function CustomerSupport({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{
    session?: string | string[];
    status?: string | string[];
  }>;
}) {
  const { customerId } = await params,
    { user, grant } = await customerPageAccess(customerId);
  const p = await searchParams,
    status = queryValue(p.status);
  return (
    <SupportInbox
      key={`${user.id}:${customerId}`}
      initialSession={queryValue(p.session).slice(0, 200)}
      initialStatus={
        ["waiting", "active", "closed"].includes(status) ? status : "waiting"
      }
      endpoint={`/api/customer/${customerId}/support`}
      portalUserId={user.id}
      canReassign={grant.role !== "agent"}
    />
  );
}
