import { handleConnection } from "@/lib/data-connections/handlers";
type Context = { params: Promise<{ customerId: string; connectionId: string }> };
export const maxDuration = 60;
async function handle(req: Request, { params }: Context) {
  const { customerId, connectionId } = await params;
  return handleConnection(req, customerId, connectionId);
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
