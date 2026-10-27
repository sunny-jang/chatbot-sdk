import sql from "@/lib/neon";
import { initSchema } from "@/lib/db";
import type { AccessDatabase } from "@/lib/access/schema";
import { portalUser } from "@/lib/customer-portal/auth";
import { body, failure, sameOrigin } from "@/lib/customer-portal/input";
import { PortalError } from "@/lib/customer-portal/validation";
import { enforceRateLimit } from "@/lib/support";
import {
  createDataConnection,
  dataConnection,
  toView,
  deleteDataConnection,
  listConnectionTables,
  listDataConnections,
  testConnectionInput,
  testDataConnection,
  updateDataConnection,
} from "./store";

/** 에이전시(/api/customers)와 데스크(/api/customer) 라우트가 같은 처리기를 쓴다. 권한은 store가 고객사 멤버십으로 판단한다. */
async function guard(req: Request, mutation: boolean, limit: number) {
  const user = await portalUser();
  await initSchema();
  if (mutation) {
    sameOrigin(req);
    if (!(await enforceRateLimit("data-connection:" + user.id, req, limit)))
      throw new PortalError("잠시 후 다시 시도해주세요.", 429);
  }
  return user;
}

export async function handleConnections(req: Request, customerId: string) {
  try {
    if (req.method === "GET") {
      const user = await guard(req, false, 0);
      return Response.json(await listDataConnections(sql as AccessDatabase, user.id, customerId));
    }
    const user = await guard(req, true, 40);
    const input = await body(req);
    if (input.action === "test")
      return Response.json(await testConnectionInput(sql as AccessDatabase, user.id, customerId, input));
    if (input.action === "create")
      return Response.json(
        await sql.begin((tx) => createDataConnection(tx as unknown as AccessDatabase, user.id, customerId, input)),
        { status: 201 },
      );
    throw new PortalError("요청을 확인해주세요.");
  } catch (e) {
    return failure(e);
  }
}

export async function handleConnection(req: Request, customerId: string, connectionId: string) {
  try {
    if (req.method === "GET") {
      const user = await guard(req, false, 0);
      const { row } = await dataConnection(sql as AccessDatabase, user.id, customerId, connectionId);
      return Response.json(toView(row));
    }
    const user = await guard(req, true, 40);
    if (req.method === "DELETE")
      return Response.json(
        await sql.begin((tx) => deleteDataConnection(tx as unknown as AccessDatabase, user.id, customerId, connectionId)),
      );
    const input = await body(req);
    if (req.method === "PATCH")
      return Response.json(
        await sql.begin((tx) => updateDataConnection(tx as unknown as AccessDatabase, user.id, customerId, connectionId, input)),
      );
    if (input.action === "test")
      return Response.json(await testDataConnection(sql as AccessDatabase, user.id, customerId, connectionId));
    if (input.action === "tables")
      return Response.json({ tables: await listConnectionTables(sql as AccessDatabase, user.id, customerId, connectionId) });
    throw new PortalError("요청을 확인해주세요.");
  } catch (e) {
    return failure(e);
  }
}
