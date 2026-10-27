/** 고객사 DB 연결. 접속 정보는 data_connections.secret_enc에 암호화돼 있고 이 타입으로만 복호화해 쓴다. */
export const CONNECTION_KINDS = ["postgres", "mysql"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const CONNECTION_LIMIT_PER_CUSTOMER = 3;
export const STATEMENT_TIMEOUT_MS = 20_000;
export const CONNECT_TIMEOUT_S = 10;
export const POOL_MAX = 2;
export const SAMPLE_LIMIT = 10;
export const READ_BATCH = 500;
/** 실시간 조회(대화 중 실행)의 실행 제한. 방문자를 오래 기다리게 하지 않는다. */
export const LOOKUP_TIMEOUT_MS = 5_000;
export const LOOKUP_CONNECT_TIMEOUT_S = 4;

export type ConnectionConfig = {
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
};

export type TableInfo = {
  /** 화면에 보이는 이름. public 스키마면 테이블 이름만, 아니면 schema.table */
  name: string;
  schema: string;
  table: string;
  kind: "table" | "view";
  rowEstimate: number | null;
};

export type ColumnInfo = { name: string; type: string; nullable: boolean };

export type SampleResult = {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
};

export type TestResult =
  | { ok: true; tableCount: number; tables: TableInfo[] }
  | { ok: false; error: string };

export type RowQuery = {
  schema: string;
  table: string;
  columns: string[];
  keyColumn: string;
  filters: RowFilter[];
};
export type RowFilter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "is_null" | "not_null";
  value?: string | number | boolean | (string | number)[];
  /** 컬럼 타입에서 정한 비교 방식. number면 숫자 비교, 없으면 값의 JS 타입으로 추정. */
  kind?: "number" | "text";
};

/** 실시간 조회 한 번. 조건 값은 방문자가 말한 값이고 항상 바인딩된다. limit은 읽을 최대 행 수(최대 결과 수+1). */
export type LookupCondition = { column: string; match: "eq" | "contains"; kind?: "number" | "text"; value: string | number };
export type LookupQuery = {
  schema: string;
  table: string;
  columns: string[];
  filters: RowFilter[];
  conditions: LookupCondition[];
  limit: number;
};
/** 실시간 조회가 실행 제한을 넘겼다. 사람 말 사유 대신 상태(timeout)로 다룬다. */
export class LookupTimeoutError extends Error {
  constructor() {
    super("lookup timeout");
  }
}
/** LIKE 패턴용 이스케이프. 방문자 값의 %·_가 와일드카드로 쓰이지 않게 한다(ESCAPE '\\'). */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => "\\" + c);

export type Connector = {
  testConnection(config: ConnectionConfig): Promise<TestResult>;
  listTables(config: ConnectionConfig): Promise<TableInfo[]>;
  sample(config: ConnectionConfig, schema: string, table: string, limit?: number): Promise<SampleResult>;
  /** 고유키 순으로 batch 단위 읽기. startAfter를 주면 그 키 다음부터. onBatch가 false를 돌려주면 멈춘다. */
  readRows(
    config: ConnectionConfig,
    query: RowQuery,
    onBatch: (rows: Record<string, unknown>[], lastKey: unknown) => Promise<boolean | void>,
    batch?: number,
    startAfter?: unknown,
  ): Promise<void>;
  /** 필터를 적용한 행 수와 그중 고유키 값이 서로 다른(NULL 제외) 행 수. 둘이 다르면 고유키로 쓸 수 없다. */
  countRows(config: ConnectionConfig, query: RowQuery): Promise<{ total: number; distinctKeys: number }>;
  /** 실시간 조회. 읽기 전용·timeoutMs 실행 제한. 제한을 넘기면 LookupTimeoutError. */
  lookup(config: ConnectionConfig, query: LookupQuery, timeoutMs?: number): Promise<Record<string, unknown>[]>;
};
