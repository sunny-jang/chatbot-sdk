import type { RowFilter } from "@/lib/data-connections/types";

export const SCHEDULES = ["manual", "hourly", "daily", "weekly"] as const;
export type Schedule = (typeof SCHEDULES)[number];
export const SOURCE_LIMIT_PER_CUSTOMER = 10;
export const DEFAULT_ROW_LIMIT = 5000;
export const MAX_ROW_LIMIT = 100000;
export const PREVIEW_DOCS = 3;
/** 한 요청에서 처리하는 행 수. 임베딩 호출을 포함해 60초 안에 끝나야 한다. */
export const IMPORT_STEP = 100;
/** 임베딩 요청 하나에 넣는 본문 글자 수 상한. 한국어 1자 ≈ 1토큰으로 보고 요청당 토큰 한도보다 넉넉히 낮춘다. */
export const EMBED_REQUEST_CHARS = 60000;

export type BodyColumn = {
  column: string;
  label: string;
  unit?: string;
  /** 원본 컬럼 타입. 숫자 타입일 때만 천 단위 구분을 넣는다(우편번호·코드의 앞자리 0 보존). */
  type?: string;
  /** 코드값 → 사람 말. 예: {"1": "판매중", "0": "품절"} */
  valueMap?: Record<string, string>;
};

export type SourceConfig = {
  connectionId: string;
  schema: string;
  table: string;
  titleColumn: string;
  keyColumn: string;
  bodyColumns: BodyColumn[];
  excludedColumns: string[];
  filters: RowFilter[];
  folderId: string | null;
  schedule: Schedule;
  rowLimit: number;
  missingRows: "archive" | "delete";
};

export type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  deleted: number;
  failed: number;
  truncated: number;
  total: number;
  finishedAt: number;
  error?: string;
};

export type ColumnRole = "title" | "key" | "body" | "excluded";
export type ColumnDraft = {
  column: string;
  type: string;
  role: ColumnRole;
  label: string;
  unit: string;
  valueMap: Record<string, string>;
  /** 개인정보로 추정되는 컬럼. 기본 제외, 포함하려면 경고를 본 뒤 켠다. */
  personal: boolean;
};
export type Draft = {
  columns: ColumnDraft[];
  questions: string[];
  draftedBy: "ai" | "rules";
};
