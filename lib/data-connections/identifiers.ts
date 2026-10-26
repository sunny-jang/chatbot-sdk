import { PortalError } from "@/lib/customer-portal/validation";
import type { ConnectionKind } from "./types";

const IDENT_MAX = 128;
/** 테이블·컬럼 이름은 항상 서버가 인용한다. 문자열 조립으로 쿼리에 넣지 않는다. */
export function quoteIdentifier(name: string, kind: ConnectionKind = "postgres"): string {
  if (typeof name !== "string" || !name.length || name.length > IDENT_MAX || /[\0\n\r]/.test(name))
    throw new PortalError("테이블 또는 컬럼 이름을 확인해주세요.");
  return kind === "mysql" ? "`" + name.replace(/`/g, "``") + "`" : '"' + name.replace(/"/g, '""') + '"';
}
export function qualifiedName(schema: string, table: string, kind: ConnectionKind = "postgres") {
  return quoteIdentifier(schema, kind) + "." + quoteIdentifier(table, kind);
}
/** 화면 이름("schema.table" 또는 "table")을 schema·table로 나눈다. 점이 없으면 기본 스키마. */
export function splitTableName(value: unknown, defaultSchema = "public"): { schema: string; table: string } {
  const name = String(value ?? "").trim();
  if (!name || name.length > IDENT_MAX * 2 + 1) throw new PortalError("테이블을 선택해주세요.");
  const dot = name.indexOf(".");
  if (dot < 0) return { schema: defaultSchema, table: name };
  const schema = name.slice(0, dot),
    table = name.slice(dot + 1);
  if (!schema || !table || table.includes(".")) throw new PortalError("테이블 이름을 확인해주세요.");
  return { schema, table };
}
export function displayTableName(schema: string, table: string, defaultSchema = "public") {
  return schema === defaultSchema ? table : `${schema}.${table}`;
}
