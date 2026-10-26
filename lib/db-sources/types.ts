import type { RowFilter } from "@/lib/data-connections/types";

export const SCHEDULES = ["manual", "hourly", "daily", "weekly"] as const;
export type Schedule = (typeof SCHEDULES)[number];
export const SOURCE_LIMIT_PER_CUSTOMER = 10;
export const DEFAULT_ROW_LIMIT = 5000;
export const MAX_ROW_LIMIT = 100000;
export const PREVIEW_DOCS = 3;
/** 한 요청에서 처리하는 행 수. 임베딩 호출을 포함해 60초 안에 끝나야 한다. */
export const IMPORT_STEP = 100;

export type BodyColumn = {
  column: string;
  label: string;
  unit?: string;
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
