import { createHash } from "node:crypto";
import type { ColumnInfo } from "@/lib/data-connections/types";
import type { BodyColumn, ColumnDraft, ColumnRole, Draft } from "./types";

/** 이름·전화·이메일·주소·주민번호·카드 등. 이름(name)은 사람 표로 보일 때만 개인정보로 본다. */
const PERSONAL = /(phone|tel|mobile|cell|email|e_mail|mail|address|addr|zip|postal|ssn|resident|jumin|passport|card_no|card_number|account_no|birth|password|passwd|pwd|token|secret|ip_addr|전화|휴대|이메일|주소|주민|계좌|카드|생년|비밀번호)/i;
const PERSON_TABLE_HINT = /(phone|tel|mobile|email|mail|address|addr|주소|전화|이메일)/i;
const NAME_COL = /^(name|full_name|user_name|username|customer_name|member_name|이름|성명|고객명|회원명)$/i;
const TIMESTAMP = /(created_at|updated_at|modified_at|deleted_at|timestamp|_ts$|^ts$|등록일|수정일|생성일)/i;
const KEY_HINT = /^(id|pk|uid|uuid|seq|no|code|sku|.*_id|.*_no|.*_code)$/i;
const TITLE_HINT = /^(name|title|product_name|item_name|menu_name|subject|label|상품명|제품명|메뉴명|제목|이름|품명)$/i;

const LABELS: Record<string, string> = {
  id: "번호", name: "이름", title: "제목", product_name: "상품명", item_name: "품목", menu_name: "메뉴",
  category: "분류", type: "종류", kind: "종류", brand: "브랜드", description: "설명", desc: "설명", detail: "상세", summary: "요약",
  price: "가격", sale_price: "할인가", list_price: "정가", cost: "원가", amount: "금액", total: "합계", fee: "요금", discount: "할인",
  stock: "재고", quantity: "수량", qty: "수량", count: "개수", size: "크기", weight: "무게", volume: "용량", color: "색상",
  status: "상태", is_active: "판매 상태", active: "판매 상태", available: "이용 가능", enabled: "사용 여부", visible: "공개 여부",
  option: "옵션", options: "옵션", tag: "태그", tags: "태그", note: "비고", memo: "메모", remark: "비고",
  address: "주소", location: "위치", branch: "지점", store: "매장", region: "지역", city: "도시",
  phone: "전화", email: "이메일", url: "링크", link: "링크", image: "이미지", image_url: "이미지",
  start_date: "시작일", end_date: "종료일", date: "날짜", time: "시간", hours: "운영 시간", open_time: "오픈 시간", close_time: "마감 시간",
  rating: "평점", grade: "등급", level: "등급", unit: "단위", origin: "원산지", material: "소재", model: "모델", spec: "사양", version: "버전",
  created_at: "등록일", updated_at: "수정일",
};
const UNITS: Record<string, string> = {
  price: "원", sale_price: "원", list_price: "원", cost: "원", amount: "원", total: "원", fee: "원", discount: "원",
  stock: "개", quantity: "개", qty: "개", count: "개", weight: "g", volume: "ml", minutes: "분", duration: "분", days: "일",
};

export function isPersonalDataColumn(column: string, allColumns: string[] = []): boolean {
  if (PERSONAL.test(column)) return true;
  if (NAME_COL.test(column) && allColumns.some((c) => c !== column && PERSON_TABLE_HINT.test(c))) return true;
  return false;
}
export function labelFor(column: string): string {
  const key = column.toLowerCase();
  if (LABELS[key]) return LABELS[key];
  const stripped = key.replace(/^(item|product|menu)_/, "");
  if (LABELS[stripped]) return LABELS[stripped];
  // snake_case → 띄어쓰기. 한국어 컬럼은 그대로.
  return column.replace(/_/g, " ").trim() || column;
}
export function unitFor(column: string, type: string): string {
  const key = column.toLowerCase();
  if (!/int|numeric|decimal|double|real|float|money|number/i.test(type)) return "";
  if (UNITS[key]) return UNITS[key];
  const stripped = key.replace(/^(item|product|menu)_/, "");
  return UNITS[stripped] ?? "";
}
const isText = (type: string) => /char|text|string|citext|varchar/i.test(type);
const isNumber = (type: string) => /int|numeric|decimal|double|real|float|money|serial|number/i.test(type);

/** 규칙 기반 초안. AI 초안이 없거나 실패하면 이 결과를 그대로 쓴다. */
export function draftColumnRoles(columns: ColumnInfo[], rows: Record<string, unknown>[]): Draft {
  const names = columns.map((c) => c.name);
  const unique = (name: string) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== "");
    return values.length === rows.length && new Set(values.map(String)).size === values.length;
  };
  let key =
    names.find((n) => /^(id|pk|uuid|uid)$/i.test(n)) ??
    names.find((n) => KEY_HINT.test(n) && unique(n)) ??
    names.find((n) => unique(n) && isNumber(columns[names.indexOf(n)].type)) ??
    names.find((n) => unique(n)) ??
    names[0];
  const textCols = columns.filter((c) => isText(c.type) && c.name !== key);
  const title =
    textCols.find((c) => TITLE_HINT.test(c.name))?.name ??
    textCols.find((c) => unique(c.name) && rows.every((r) => String(r[c.name] ?? "").length <= 80))?.name ??
    textCols[0]?.name ??
    key;
  if (title === key && textCols.length === 0 && names.length > 1) key = names.find((n) => n !== title) ?? key;
  const drafts: ColumnDraft[] = columns.map((c) => {
    const personal = isPersonalDataColumn(c.name, names);
    let role: ColumnRole = "body";
    if (c.name === key) role = "key";
    else if (c.name === title) role = "title";
    else if (personal || TIMESTAMP.test(c.name) || /(password|secret|hash|token)/i.test(c.name)) role = "excluded";
    else if (/bytea|blob|binary|json|xml|array|vector/i.test(c.type)) role = "excluded";
    return { column: c.name, type: c.type, role, label: labelFor(c.name), unit: unitFor(c.name, c.type), valueMap: {}, personal };
  });
  // 0/1만 있는 정수 컬럼은 값 매핑 초안을 비워 두되 상태 컬럼으로 라벨링한다(사용자가 채움).
  for (const d of drafts) {
    const values = new Set(rows.map((r) => String(r[d.column] ?? "")).filter(Boolean));
    if (d.role === "body" && isNumber(d.type) && values.size && [...values].every((v) => v === "0" || v === "1"))
      d.valueMap = /active|enabled|available|visible|sale/i.test(d.column) ? { "1": "판매중", "0": "품절" } : { "1": "예", "0": "아니오" };
  }
  const titleLabel = drafts.find((d) => d.role === "title")?.label ?? "항목";
  const bodyLabels = drafts.filter((d) => d.role === "body").map((d) => d.label);
  const sampleTitle = rows[0] ? String(rows[0][title] ?? "").slice(0, 30) : "";
  const questions = [
    sampleTitle ? `${sampleTitle} ${bodyLabels[0] ? bodyLabels[0] + "이(가)" : ""} 어떻게 되나요?` : `${titleLabel} 목록을 알려주세요.`,
    bodyLabels.includes("가격") ? "가장 저렴한 건 뭐예요?" : `${bodyLabels[1] ?? titleLabel}에 대해 알려주세요.`,
    sampleTitle ? `${sampleTitle} 있어요?` : "어떤 항목이 있나요?",
  ];
  return { columns: drafts, questions, draftedBy: "rules" };
}

export function parseValueMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of text.split(/[,\n]/)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(),
      v = part.slice(i + 1).trim();
    if (k && v) map[k] = v;
  }
  return map;
}
export function formatValueMap(map: Record<string, string> | undefined): string {
  return Object.entries(map ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

/** 값을 챗봇이 읽을 문장 조각으로. 숫자는 천 단위 구분 + 단위, 날짜는 YYYY-MM-DD, 매핑된 코드는 사람 말. */
export function formatValue(value: unknown, col: BodyColumn): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => formatValue(v, { ...col, valueMap: col.valueMap })).filter(Boolean).join(", ") || null;
  if (typeof value === "object") return JSON.stringify(value);
  const raw = String(value).trim();
  if (raw === "") return null;
  if (col.valueMap && col.valueMap[raw] !== undefined) return col.valueMap[raw];
  if (typeof value === "boolean") return col.valueMap?.[String(value)] ?? (value ? "예" : "아니오");
  if (typeof value === "number" || /^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    const text = Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    return col.unit ? `${text}${col.unit}` : text;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return raw;
}

/** 행 하나 → 문서 하나. 본문은 "라벨: 값" 줄이다. */
export function renderRowDocument(
  row: Record<string, unknown>,
  config: { titleColumn: string; bodyColumns: BodyColumn[]; tableLabel?: string },
): { title: string; content: string } {
  const titleRaw = row[config.titleColumn];
  const title = (titleRaw === null || titleRaw === undefined ? "" : String(titleRaw).trim()).slice(0, 300) || "(제목 없음)";
  const lines: string[] = [];
  for (const col of config.bodyColumns) {
    if (col.column === config.titleColumn) continue;
    const text = formatValue(row[col.column], col);
    if (text === null) continue;
    lines.push(`${col.label || col.column}: ${text}`);
  }
  const head = config.tableLabel ? `${config.tableLabel}: ${title}` : title;
  return { title, content: [head, ...lines].join("\n").slice(0, 50000) };
}

export const rowHash = (title: string, content: string) => createHash("sha256").update(title + "\u0000" + content).digest("hex");
export const rowKeyOf = (value: unknown) => (value === null || value === undefined ? "" : String(value));
