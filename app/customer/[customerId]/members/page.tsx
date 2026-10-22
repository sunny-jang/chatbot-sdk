import { customerPageAccess } from "@/lib/customer-portal/page";
import Members from "@/app/customers/[customerId]/Members";
export default async function CustomerMembers({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params,
    { grant } = await customerPageAccess(customerId, "members.agent");
  return (
    <Members customerId={customerId} owner={grant.role === "owner"} portal />
  );
}
