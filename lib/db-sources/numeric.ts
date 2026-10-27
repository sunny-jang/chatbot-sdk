/**
 * 숫자 조건이 있는 질문("2만원 이하 선물세트", "3개 이상")을 문서의 숫자 필드로 먼저 거른다.
 * 임베딩만으로는 "이하/이상" 같은 크기 비교가 약하기 때문이다.
 */
export type NumericField = { column: string; label: string; unit: string; value: number };
export type NumericIntent = { op: "lte" | "gte" | "lt" | "gt"; value: number; unit: string };

const UNIT_ALIASES: Record<string, string> = { 원: "원", 개: "개", 명: "명", 인: "명", 분: "분", 시간: "시간", 일: "일", g: "g", kg: "kg", ml: "ml" };
const UNIT_RE = "(원|개|명|인|분|시간|일|kg|g|ml)";

/** "2만", "1.5만", "3천", "2만5천", "15,000" → 숫자 */
export function parseKoreanNumber(text: string): number | null {
  const t = text.replace(/,/g, "").replace(/\s+/g, "");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)천)?(?:(\d+(?:\.\d+)?)백)?(\d+)?$/);
  if (!m || m.slice(1).every((x) => x === undefined)) return null;
  const [, eok, man, cheon, baek, rest] = m;
  return (Number(eok ?? 0) * 1e8) + (Number(man ?? 0) * 1e4) + (Number(cheon ?? 0) * 1e3) + (Number(baek ?? 0) * 1e2) + Number(rest ?? 0);
}

const NUM = "(\\d[\\d,]*(?:\\.\\d+)?(?:억|만|천|백)?(?:\\d+(?:억|만|천|백)?)*)";

/** 질문에서 숫자 조건을 뽑는다. 단위가 없는 숫자는 조건으로 보지 않는다(모델명·연도 오인 방지). */
export function parseNumericIntent(text: string): NumericIntent[] {
  const out: NumericIntent[] = [];
  const s = text.replace(/\s+/g, " ");
  const range = new RegExp(`${NUM}\\s*${UNIT_RE}?\\s*[~\\-]\\s*${NUM}\\s*${UNIT_RE}`, "g");
  let m: RegExpExecArray | null;
  const used: [number, number][] = [];
  while ((m = range.exec(s))) {
    const unit = UNIT_ALIASES[m[4]];
    const a = parseKoreanNumber(m[1]),
      b = parseKoreanNumber(m[3]);
    if (a === null || b === null) continue;
    out.push({ op: "gte", value: Math.min(a, b), unit }, { op: "lte", value: Math.max(a, b), unit });
    used.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`${NUM}\\s*${UNIT_RE}(대)?\\s*(이하|이상|미만|초과|까지|부터|안\\s?넘는|넘지\\s?않는|넘는|보다\\s?(?:싼|저렴한|적은|작은|짧은)|보다\\s?(?:비싼|많은|큰|긴)|아래|내외|정도)?`, "g");
  while ((m = single.exec(s))) {
    const at = m.index;
    if (used.some(([a, b]) => at >= a && at < b)) continue;
    const value = parseKoreanNumber(m[1]);
    const unit = UNIT_ALIASES[m[2]];
    if (value === null || !unit) continue;
    const word = (m[4] ?? "").replace(/\s/g, "");
    if (m[3] === "대") {
      // "2만원대" → 2만 이상 3만 미만(자릿수 기준)
      const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(value || 1))));
      out.push({ op: "gte", value, unit }, { op: "lt", value: value + step, unit });
    } else if (/^(이하|까지|안넘는|넘지않는|아래)$/.test(word)) out.push({ op: "lte", value, unit });
    else if (/^(이상|부터)$/.test(word)) out.push({ op: "gte", value, unit });
    else if (/^(미만|보다(싼|저렴한|적은|작은|짧은))$/.test(word)) out.push({ op: "lt", value, unit });
    else if (/^(초과|넘는|보다(비싼|많은|큰|긴))$/.test(word)) out.push({ op: "gt", value, unit });
  }
  return out;
}

/** 조건과 같은 단위의 숫자 필드가 있는 문서만 조건을 따진다. 해당 단위 필드가 없는 문서(일반 문서)는 통과. */
export function passesNumericIntent(fields: NumericField[] | null | undefined, intents: NumericIntent[]): boolean {
  if (!intents.length || !fields?.length) return true;
  for (const intent of intents) {
    const candidates = fields.filter((f) => f.unit === intent.unit);
    if (!candidates.length) continue;
    const ok = candidates.some((f) =>
      intent.op === "lte" ? f.value <= intent.value : intent.op === "gte" ? f.value >= intent.value : intent.op === "lt" ? f.value < intent.value : f.value > intent.value,
    );
    if (!ok) return false;
  }
  return true;
}
