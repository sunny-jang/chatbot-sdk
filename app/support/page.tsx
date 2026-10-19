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
  const params = await searchParams;
  const requestedStatus = queryValue(params.status);
  const status = ["waiting", "active", "closed"].includes(requestedStatus)
    ? requestedStatus
    : "waiting";
  const session = queryValue(params.session).slice(0, 200);
  return (
    <SupportInbox
      key={`${session}:${status}`}
      initialSession={session}
      initialStatus={status}
    />
  );
}
