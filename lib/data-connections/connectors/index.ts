import type { ConnectionKind, Connector } from "../types";
import { mysqlConnector } from "./mysql";
import { postgresConnector } from "./postgres";

export function connectorFor(kind: ConnectionKind): Connector {
  return kind === "mysql" ? mysqlConnector : postgresConnector;
}
