import { customerPageAccess } from "@/lib/customer-portal/page";
import Requests from "./Requests";
export default async function CustomerRequestsPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const { user } = await customerPageAccess(customerId, "requests.read");
  return <Requests key={`${user.id}:${customerId}`} customerId={customerId} />;
}
