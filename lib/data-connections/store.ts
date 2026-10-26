import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "@/lib/access/schema";
import { resolveCustomerAccess, type CustomerGrant } from "@/lib/access/queries";
import type { Permission } from "@/lib/access/policy";
import { PortalError, text } from "@/lib/customer-portal/validation";
import { decrypt, encrypt } from "@/lib/crypto";
import { connectorFor } from "./connectors";
import { connectionHostname, connectionPort } from "./host";
import {
  CONNECTION_KINDS,
  CONNECTION_LIMIT_PER_CUSTOMER,
  type ConnectionConfig,
  type ConnectionKind,
  type TestResult,
} from "./types";

export type DataConnectionRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  secret_enc: string | null;
  ssl: boolean;
  status: "untested" | "ok" | "error" | "deleted";
  last_tested_at: number | null;
  last_error: string | null;
  table_count: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

/** 화면·API에 내보내는 모양. 비밀값은 절대 포함하지 않는다. */
export type DataConnectionView = {
  id: string;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  has_secret: boolean;
  status: "untested" | "ok" | "error";
  last_tested_at: number | null;
  last_error: string | null;
  table_count: number | null;
  created_at: number;
  updated_at: number;
};

export function toView(row: DataConnectionRow): DataConnectionView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    host: row.host,
    port: Number(row.port),
    database: row.database,
    username: row.username,
    ssl: Boolean(row.ssl),
    has_secret: row.secret_enc !== null,
    status: row.status === "deleted" ? "error" : row.status,
    last_tested_at: row.last_tested_at === null ? null : Number(row.last_tested_at),
    last_error: row.last_error,
    table_count: row.table_count === null ? null : Number(row.table_count),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export const NOT_FOUND = "데이터 연결을 찾을 수 없습니다.";

/** 고객사 범위 밖이면 404로만 답한다(존재 여부를 알려주지 않는다). */
export async function connectionAccess(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  permission: Permission,
): Promise<CustomerGrant> {
  const grant = await resolveCustomerAccess(db, userId, customerId, permission);
  if (!grant) throw new PortalError(NOT_FOUND, 404);
  return grant;
}

async function audit(
  db: AccessDatabase,
  userId: string,
  grant: CustomerGrant,
  action: string,
  target: string | null,
) {
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${grant.tenant_id},${grant.customer_id},${action},${target},'success')`;
}

export async function listDataConnections(db: AccessDatabase, userId: string, customerId: string) {
  await connectionAccess(db, userId, customerId, "knowledge.manage");
  const rows = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE customer_id=${customerId} AND status<>'deleted' ORDER BY created_at,id`;
  return rows.map(toView);
}

export async function dataConnection(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  connectionId: string,
  permission: Permission = "knowledge.manage",
  lock = false,
) {
  const grant = await connectionAccess(db, userId, customerId, permission);
  const [row] = lock
    ? await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${connectionId} AND customer_id=${customerId} AND tenant_id=${grant.tenant_id} AND status<>'deleted' FOR UPDATE`
    : await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${connectionId} AND customer_id=${customerId} AND tenant_id=${grant.tenant_id} AND status<>'deleted'`;
  if (!row) throw new PortalError(NOT_FOUND, 404);
  return { row, grant };
}

function connectionKind(value: unknown): ConnectionKind {
  if (!CONNECTION_KINDS.includes(value as ConnectionKind)) throw new PortalError("DB 종류를 선택해주세요.");
  return value as ConnectionKind;
}
function secret(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new PortalError("비밀번호를 입력해주세요.");
    return null;
  }
  if (typeof value !== "string" || value.length > 200 || /[\0\n\r]/.test(value))
    throw new PortalError("비밀번호를 확인해주세요.");
  return value;
}
/** 폼 입력 → 검증된 접속 정보. 수정 시에는 기존 행 위에 덮어쓴다. */
export function connectionInput(input: Record<string, unknown>, existing?: DataConnectionRow) {
  const pick = <T,>(key: string, parse: (v: unknown) => T, fallback: T | undefined): T => {
    if (input[key] === undefined && fallback !== undefined) return fallback;
    return parse(input[key]);
  };
  return {
    name: pick("name", (v) => text(v, "연결 이름", 80), existing?.name),
    kind: pick("kind", connectionKind, existing?.kind),
    host: pick("host", connectionHostname, existing?.host),
    port: pick("port", connectionPort, existing ? Number(existing.port) : undefined),
    database: pick("database", (v) => text(v, "데이터베이스 이름", 120), existing?.database),
    username: pick("username", (v) => text(v, "사용자 이름", 120), existing?.username),
    ssl: pick("ssl", (v) => {
      if (typeof v !== "boolean") throw new PortalError("SSL 설정을 확인해주세요.");
      return v;
    }, existing ? Boolean(existing.ssl) : true),
    password: secret(input.password, !existing),
  };
}

export function credentialsOf(row: DataConnectionRow): ConnectionConfig {
  if (!row.secret_enc) throw new PortalError("접속 정보가 삭제된 연결이에요. 연결을 다시 만들어주세요.", 409);
  let password: string;
  try {
    password = decrypt(row.secret_enc);
  } catch {
    throw new PortalError("저장된 접속 정보를 읽지 못했어요. 비밀번호를 다시 입력해 저장해주세요.", 409);
  }
  return {
    kind: row.kind,
    host: row.host,
    port: Number(row.port),
    database: row.database,
    username: row.username,
    password,
    ssl: Boolean(row.ssl),
  };
}

export async function createDataConnection(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  input: Record<string, unknown>,
) {
  const grant = await connectionAccess(db, userId, customerId, "settings.manage");
  const values = connectionInput(input);
  connectorFor(values.kind); // 아직 지원하지 않는 종류면 여기서 거부
  await db`SELECT id FROM customers WHERE id=${customerId} FOR UPDATE`;
  const [{ count }] = await db`SELECT count(*)::int AS count FROM data_connections WHERE customer_id=${customerId} AND status<>'deleted'`;
  if (Number(count) >= CONNECTION_LIMIT_PER_CUSTOMER)
    throw new PortalError(`고객사당 데이터 연결은 ${CONNECTION_LIMIT_PER_CUSTOMER}개까지 만들 수 있어요.`, 409);
  const id = randomUUID();
  const [row] = await db<DataConnectionRow[]>`INSERT INTO data_connections(id,tenant_id,customer_id,name,kind,host,port,database,username,secret_enc,ssl,created_by)
    VALUES(${id},${grant.tenant_id},${customerId},${values.name},${values.kind},${values.host},${values.port},${values.database},${values.username},${encrypt(values.password as string)},${values.ssl},${userId}) RETURNING *`;
  await audit(db, userId, grant, "data_connection.create", id);
  return toView(row);
}

export async function updateDataConnection(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  connectionId: string,
  input: Record<string, unknown>,
) {
  const { row, grant } = await dataConnection(db, userId, customerId, connectionId, "settings.manage", true);
  const values = connectionInput(input, row);
  connectorFor(values.kind);
  const credentialsChanged =
    values.host !== row.host ||
    values.port !== Number(row.port) ||
    values.database !== row.database ||
    values.username !== row.username ||
    values.ssl !== Boolean(row.ssl) ||
    values.password !== null ||
    values.kind !== row.kind;
  const [updated] = await db<DataConnectionRow[]>`UPDATE data_connections SET
    name=${values.name}, kind=${values.kind}, host=${values.host}, port=${values.port}, database=${values.database}, username=${values.username}, ssl=${values.ssl},
    secret_enc=${values.password === null ? row.secret_enc : encrypt(values.password)},
    status=${credentialsChanged ? "untested" : row.status}, last_error=${credentialsChanged ? null : row.last_error},
    updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
    WHERE id=${connectionId} RETURNING *`;
  await audit(db, userId, grant, "data_connection.update", connectionId);
  return toView(updated);
}

/** 접속 정보 즉시 파기. 행은 남겨 소스가 "연결 삭제됨"을 표시할 수 있게 한다. */
export async function deleteDataConnection(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  connectionId: string,
) {
  const { grant } = await dataConnection(db, userId, customerId, connectionId, "settings.manage", true);
  await db`UPDATE data_connections SET secret_enc=NULL, status='deleted', deleted_at=EXTRACT(EPOCH FROM NOW())::BIGINT, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${connectionId}`;
  await audit(db, userId, grant, "data_connection.delete", connectionId);
  return { ok: true };
}

/** 저장 전 입력값으로 테스트. 아무것도 저장하지 않고 감사만 남긴다. */
export async function testConnectionInput(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  input: Record<string, unknown>,
): Promise<TestResult> {
  const grant = await connectionAccess(db, userId, customerId, "settings.manage");
  let existing: DataConnectionRow | undefined;
  if (typeof input.id === "string" && input.id) {
    // 수정 중 테스트: 비밀번호를 비우면 저장된 비밀번호로 테스트한다.
    existing = (await dataConnection(db, userId, customerId, input.id, "settings.manage")).row;
  }
  const values = connectionInput(input, existing);
  const password = values.password ?? (existing ? credentialsOf(existing).password : null);
  if (!password) throw new PortalError("비밀번호를 입력해주세요.");
  const result = await connectorFor(values.kind).testConnection({
    kind: values.kind,
    host: values.host,
    port: values.port,
    database: values.database,
    username: values.username,
    password,
    ssl: values.ssl,
  });
  await audit(db, userId, grant, "data_connection.test", existing?.id ?? null);
  return result;
}

/** 저장된 연결 테스트. 상태·시각·사유·테이블 수를 갱신한다. */
export async function testDataConnection(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  connectionId: string,
) {
  const { row, grant } = await dataConnection(db, userId, customerId, connectionId, "knowledge.manage");
  const result = await connectorFor(row.kind).testConnection(credentialsOf(row));
  const [updated] = await db<DataConnectionRow[]>`UPDATE data_connections SET
    status=${result.ok ? "ok" : "error"}, last_error=${result.ok ? null : result.error},
    table_count=${result.ok ? result.tableCount : row.table_count},
    last_tested_at=EXTRACT(EPOCH FROM NOW())::BIGINT, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
    WHERE id=${connectionId} AND status<>'deleted' RETURNING *`;
  await audit(db, userId, grant, "data_connection.test", connectionId);
  return { result, connection: toView(updated ?? row) };
}

export async function listConnectionTables(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  connectionId: string,
) {
  const { row } = await dataConnection(db, userId, customerId, connectionId, "knowledge.manage");
  return connectorFor(row.kind).listTables(credentialsOf(row));
}
