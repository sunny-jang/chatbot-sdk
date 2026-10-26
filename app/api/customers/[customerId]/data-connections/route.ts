import { handleConnections } from "@/lib/data-connections/handlers";
type Context = { params: Promise<{ customerId: string }> };
export const maxDuration = 60;
async function handle(req: Request, { params }: Context) {
  const { customerId } = await params;
  return handleConnections(req, customerId);
}
export { handle as GET, handle as POST };
