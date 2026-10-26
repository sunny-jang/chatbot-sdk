/** 고객사 DB 연결. 접속 정보는 data_connections.secret_enc에 암호화돼 있고 이 타입으로만 복호화해 쓴다. */
export const CONNECTION_KINDS = ["postgres", "mysql"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const CONNECTION_LIMIT_PER_CUSTOMER = 3;
export const STATEMENT_TIMEOUT_MS = 20_000;
export const CONNECT_TIMEOUT_S = 10;
export const POOL_MAX = 2;
export const SAMPLE_LIMIT = 10;
export const READ_BATCH = 500;

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

export type Connector = {
  testConnection(config: ConnectionConfig): Promise<TestResult>;
  listTables(config: ConnectionConfig): Promise<TableInfo[]>;
  sample(config: ConnectionConfig, schema: string, table: string, limit?: number): Promise<SampleResult>;
  /** 고유키 순으로 batch 단위 읽기. cursor는 마지막 키 값(JSON 문자열) */
  readRows(
    config: ConnectionConfig,
    query: RowQuery,
    onBatch: (rows: Record<string, unknown>[]) => Promise<boolean | void>,
    batch?: number,
  ): Promise<void>;
};
