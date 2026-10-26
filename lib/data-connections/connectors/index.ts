import { PortalError } from "@/lib/customer-portal/validation";
import type { ConnectionKind, Connector } from "../types";
import { postgresConnector } from "./postgres";

export function connectorFor(kind: ConnectionKind): Connector {
  if (kind === "postgres") return postgresConnector;
  throw new PortalError("MySQL 연결은 준비 중이에요. 지금은 PostgreSQL만 연결할 수 있어요.", 400);
}
