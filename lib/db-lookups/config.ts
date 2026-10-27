import { PortalError, text } from "@/lib/customer-portal/validation";
import { quoteIdentifier } from "@/lib/data-connections/identifiers";
import type { LookupCondition, RowFilter } from "@/lib/data-connections/types";
import { formatValue, isPersonalDataColumn } from "@/lib/db-sources/render";
import { filtersOf } from "@/lib/db-sources/store";
import type { BodyColumn } from "@/lib/db-sources/types";

/** 실시간 조회 설정과 방문자 값 검사. DB·네트워크를 쓰지 않는 순수 함수만 둔다(PRD-db-live-lookup §3). */
export const LOOKUP_LIMIT_PER_BOT = 5;
export const MAX_PARAMS = 3;
export const MAX_OUTPUTS = 12;
export const DEFAULT_MAX_ROWS = 5;
export const MAX_ROWS = 10;
/** 한 메시지에서 실행하는 조회 수(G5). */
export const CALLS_PER_MESSAGE = 2;
/** 대화 하나에서 10분 동안(G6). */
export const CALLS_PER_SESSION = 10;
export const SESSION_WINDOW_S = 600;
/** 챗봇 하나에서 1분 동안 고객사 DB에 실제로 접속하는 횟수(G6, 캐시 제외). */
export const CALLS_PER_BOT_MINUTE = 60;
export const CACHE_SECONDS = 30;
export const MIN_CONTAINS_CHARS = 2;

export const TOO_BROAD_MESSAGE = "한 번에 확인하기엔 범위가 너무 넓어요. 상품명처럼 하나를 정해서 물어봐 주세요.";

export type LookupParam = { column: string; label: string; match: "eq" | "contains"; required: boolean; kind: "number" | "text" };
export type LookupOutput = BodyColumn;
export type LookupConfig = {
  connectionId: string;
  name: string;
  description: string;
  schema: string;
  table: string;
  params: LookupParam[];
  outputs: LookupOutput[];
  filters: RowFilter[];
  maxRows: number;
  enabled: boolean;
};
export type LookupStatus = "ok" | "empty" | "need_input" | "too_broad" | "too_many_calls" | "rate_limited" | "timeout" | "error";
export type LookupResult = {
  status: LookupStatus;
  /** 라벨을 붙인 결과 행. ok일 때만 있다. */
  rows?: Record<string, string>[];
  /** 모델·화면에 그대로 보여줄 안내. ok가 아닐 때만 있다. */
  message?: string;
  cached?: boolean;
  /** 결과 기준 시각(초). */
  at: number;
};

const ident = (v: unknown, label: string) => {
  const s = text(v, label, 128);
  quoteIdentifier(s);
  return s;
};
const isNumberType = (type: string) => /int|numeric|decimal|double|real|float|money|serial|number/i.test(type);

/**
 * 폼 입력 → 검증된 조회 설정. columns가 있으면(표의 실제 컬럼 목록) 개인정보 추정을 표 전체 기준으로 판단한다.
 * G1: 조건 컬럼 1개 이상, 그중 필수 1개 이상. 개인정보 추정 컬럼은 조건·보여줄 컬럼 모두 불가(본인 확인은 2단계).
 */
export function lookupConfig(input: Record<string, unknown>, columns: string[] = []): LookupConfig {
  const connectionId = text(input.connectionId, "데이터 연결", 200);
  const name = text(input.name, "조회 이름", 40);
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 200) : "";
  const schema = ident(input.schema ?? "public", "스키마");
  const table = ident(input.table, "테이블");
  const all = columns.length ? columns : [];
  const personal = (column: string) => isPersonalDataColumn(column, all);

  const rawParams = Array.isArray(input.params) ? input.params : [];
  if (!rawParams.length) throw new PortalError("방문자가 말해야 하는 조건 컬럼을 하나 이상 골라주세요. 조건 없는 전체 조회는 만들 수 없어요.");
  if (rawParams.length > MAX_PARAMS) throw new PortalError(`조건 컬럼은 ${MAX_PARAMS}개까지 고를 수 있어요.`);
  const params: LookupParam[] = rawParams.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const column = ident(o.column, "조건 컬럼");
    if (personal(column)) throw new PortalError(`개인정보로 보이는 컬럼(${column})은 실시간 조회 조건으로 쓸 수 없어요.`);
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 30) : column;
    const kind = o.kind === "number" || (typeof o.type === "string" && isNumberType(o.type)) ? "number" : "text";
    const match = o.match === "contains" && kind === "text" ? "contains" : "eq";
    return { column, label, match, required: o.required !== false, kind };
  });
  if (new Set(params.map((p) => p.column)).size !== params.length) throw new PortalError("같은 조건 컬럼을 두 번 고를 수 없어요.");
  if (!params.some((p) => p.required)) throw new PortalError("조건 중 하나 이상은 필수여야 해요. 조건 없이 실행되면 전체를 읽게 돼요.");

  const rawOutputs = Array.isArray(input.outputs) ? input.outputs : [];
  if (!rawOutputs.length) throw new PortalError("답에 쓸 컬럼을 하나 이상 골라주세요.");
  if (rawOutputs.length > MAX_OUTPUTS) throw new PortalError(`답에 쓸 컬럼은 ${MAX_OUTPUTS}개까지 고를 수 있어요.`);
  const outputs: LookupOutput[] = rawOutputs.map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const column = ident(o.column, "답에 쓸 컬럼");
    if (personal(column)) throw new PortalError(`개인정보로 보이는 컬럼(${column})은 답에 쓸 수 없어요.`);
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : column;
    const unit = typeof o.unit === "string" ? o.unit.trim().slice(0, 10) : "";
    const type = typeof o.type === "string" ? o.type.trim().slice(0, 60) : "";
    const valueMap: Record<string, string> = {};
    if (o.valueMap && typeof o.valueMap === "object")
      for (const [k, v] of Object.entries(o.valueMap as Record<string, unknown>).slice(0, 50)) valueMap[String(k).slice(0, 50)] = String(v).slice(0, 50);
    return { column, label, ...(type ? { type } : {}), ...(unit ? { unit } : {}), ...(Object.keys(valueMap).length ? { valueMap } : {}) };
  });
  if (new Set(outputs.map((o) => o.column)).size !== outputs.length) throw new PortalError("같은 컬럼을 답에 두 번 넣을 수 없어요.");

  // 고정 조건은 DB 지식 소스와 같은 검사를 쓴다.
  const filters = filtersOf(input.filters);

  const maxRows = input.maxRows === undefined || input.maxRows === "" ? DEFAULT_MAX_ROWS : Number(input.maxRows);
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) throw new PortalError(`최대 결과 수는 1~${MAX_ROWS} 사이로 입력해주세요.`);
  return { connectionId, name, description, schema, table, params, outputs, filters, maxRows, enabled: input.enabled !== false };
}

/** 넓은 값(G3). 와일드카드·"전체"류·포함 검색 1글자. */
const BROAD_VALUE = /^(\*+|%+|_+|\.+|전체|모두|모든|전부|다|아무거나|아무것이나|전체\s*다|all|any|everything)$/i;

/**
 * 모델이 채운 값 → 실행할 조건. 실행하면 안 되면 상태와 안내를 돌려준다.
 * G2: 필수 값이 비면 need_input. G3: 넓은 값·짧은 포함 값이면 too_broad. 선택 조건이 비면 조건에서 뺀다.
 */
export function checkLookupArgs(
  params: LookupParam[],
  args: Record<string, unknown>,
): { ok: true; conditions: LookupCondition[] } | { ok: false; status: "need_input" | "too_broad"; message: string } {
  const conditions: LookupCondition[] = [];
  const missing: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const raw = args[paramKey(i)];
    const value = raw === undefined || raw === null ? "" : String(raw).trim().slice(0, 100);
    if (!value) {
      if (p.required) missing.push(p.label);
      continue;
    }
    if (BROAD_VALUE.test(value)) return { ok: false, status: "too_broad", message: TOO_BROAD_MESSAGE };
    if (p.kind === "number") {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { ok: false, status: "need_input", message: `${p.label}을(를) 숫자로 알려주세요.` };
      conditions.push({ column: p.column, match: "eq", kind: "number", value: n });
      continue;
    }
    if (p.match === "contains" && [...value].length < MIN_CONTAINS_CHARS) return { ok: false, status: "too_broad", message: TOO_BROAD_MESSAGE };
    conditions.push({ column: p.column, match: p.match, kind: "text", value });
  }
  if (missing.length) return { ok: false, status: "need_input", message: `조회하려면 ${missing.join(", ")}이(가) 필요해요. 방문자에게 물어봐 주세요.` };
  if (!conditions.length) return { ok: false, status: "too_broad", message: TOO_BROAD_MESSAGE };
  return { ok: true, conditions };
}

/**
 * 대량 요청 표현(G8). 이런 질문에는 조회 도구를 주지 않는다.
 * "전체 메뉴 중 라떼 가격"처럼 특정 대상을 묻는 문장은 넓은 요청이 아니다.
 */
const ALL_WORD = /(전부|전체|모든|모두|싹\s*다|통째로)/;
const LIST_VERB = /(보여|알려|뽑아|정리|나열|출력|조회|확인|리스트|목록)/;
const BROAD_REQUEST = [
  /(\S+)\s*(을|를)?\s*(다|죄다)\s*(보여|알려|뽑아|정리|나열|출력)/,
  /(합계|총합|총액|총\s*매출|평균|통계|집계|순위|랭킹|top\s*\d+|상위\s*\d+|하위\s*\d+)/i,
  /(엑셀|excel|csv|다운로드|내려받|파일로)/i,
  /(지난|최근|작년|올해|이번\s*(달|해|분기))\s*(\d+\s*)?(년|개월|달|분기|주)?\s*(치|동안|간)?\s*(의\s*)?(전체|모든|전부)?\s*(주문|매출|예약|판매|내역|기록)/,
];
const SPECIFIC_TARGET = /(중에?서?|중)\s*\S+\s*(가격|재고|있|얼마|몇)/;
export function isBroadRequest(message: string): boolean {
  const m = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!m) return false;
  if (SPECIFIC_TARGET.test(m) && !/(합계|총합|평균|통계|엑셀|다운로드|csv)/i.test(m)) return false;
  if (ALL_WORD.test(m) && LIST_VERB.test(m)) return true;
  return BROAD_REQUEST.some((r) => r.test(m));
}

/** 결과 행 → 라벨이 붙은 값(라벨: 값). 원본 컬럼 이름은 모델에게 보내지 않는다. */
export function formatLookupRows(rows: Record<string, unknown>[], outputs: LookupOutput[]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const o of outputs) {
      const v = formatValue(row[o.column], o);
      out[o.label] = v ?? "(없음)";
    }
    return out;
  });
}

export const paramKey = (index: number) => `p${index + 1}`;
export const toolName = (index: number) => `lookup_${index + 1}`;

/** OpenAI 도구 정의. 이름은 lookup_N, 파라미터는 p1..p3(설명에 라벨). 필수 조건만 required. */
export function toolDefinition(index: number, lookup: Pick<LookupConfig, "name" | "description" | "params" | "maxRows">) {
  const properties: Record<string, { type: "string"; description: string }> = {};
  lookup.params.forEach((p, i) => {
    properties[paramKey(i)] = {
      type: "string",
      description: `${p.label}${p.kind === "number" ? "(숫자)" : ""}${p.match === "contains" ? " — 일부만 말해도 됨(2글자 이상)" : " — 방문자가 말한 정확한 값"}${p.required ? "" : " (선택)"}`,
    };
  });
  return {
    type: "function" as const,
    function: {
      name: toolName(index),
      description: `실시간 조회 "${lookup.name}". ${lookup.description ? lookup.description + ". " : ""}방문자가 ${lookup.params
        .filter((p) => p.required)
        .map((p) => p.label)
        .join(", ")}을(를) 구체적으로 말했을 때만 사용한다. 결과는 최대 ${lookup.maxRows}건. 전체 목록·합계·통계에는 사용하지 않는다.`,
      parameters: {
        type: "object",
        properties,
        required: lookup.params.flatMap((p, i) => (p.required ? [paramKey(i)] : [])),
        additionalProperties: false,
      },
    },
  };
}

/** 조회 도구가 붙은 대화의 시스템 지시(G 규칙의 모델 쪽 절반). */
export const LIVE_LOOKUP_INSTRUCTIONS = [
  "실시간 조회 도구가 있다. 재고·잔여석·영업 여부처럼 지금 값이 필요한 질문에서, 방문자가 대상을 구체적으로 말했을 때만 도구를 쓴다.",
  "대상이 빠졌으면 도구를 부르지 말고 무엇을 조회할지 하나만 되물어라.",
  "도구 결과의 status가 ok가 아니면 결과의 message 내용대로 안내하고, 결과에 없는 숫자·재고·시간을 절대 지어내지 마라.",
  `전체 목록·전부 보여주기·합계·평균·통계·순위·기간 전체 내역·파일 내보내기처럼 범위가 넓은 요청에는 도구를 쓰지 말고 "${TOO_BROAD_MESSAGE}"라고 답하라.`,
  "도구 결과는 조회한 시점의 값이다. 숫자를 말할 때 '지금 기준'임을 자연스럽게 밝혀라.",
].join("\n");

export const BROAD_REQUEST_INSTRUCTIONS = `이번 질문은 범위가 넓은 요청이라 실시간 조회를 하지 않는다. 참고 문서로 답할 수 있으면 문서로 답하고, 실시간 값(재고·잔여석 등)을 전부 또는 대량으로 요구하거나 합계·통계·내보내기를 요구하면 "${TOO_BROAD_MESSAGE}"라고 답하라. 숫자를 지어내지 마라.`;

/** 출처 표시용 라벨: "재고 조회 · 14:03 기준"(KST). */
export function liveSourceLabel(name: string, at: number) {
  const d = new Date((at + 9 * 3600) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${name} · ${hh}:${mm} 기준`;
}
