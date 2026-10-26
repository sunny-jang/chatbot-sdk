import OpenAI from "openai";
import type { ColumnInfo } from "@/lib/data-connections/types";
import { draftColumnRoles } from "./render";
import type { ColumnRole, Draft } from "./types";

const ROLES: ColumnRole[] = ["title", "key", "body", "excluded"];
const SYSTEM = `당신은 고객사 데이터베이스 테이블을 챗봇 지식 문서로 바꾸는 설정을 제안합니다.
각 컬럼에 역할(title=행 제목, key=고유키, body=본문에 넣을 값, excluded=제외)과 챗봇이 읽을 한국어 라벨, 숫자 단위(원·개·g 등, 없으면 빈 문자열), 코드값 매핑(예 {"1":"판매중","0":"품절"}, 없으면 {})을 정합니다.
규칙: title과 key는 각각 정확히 하나. 내부 코드·해시·타임스탬프·개인정보(이름·전화·이메일·주소·주민번호·카드)는 excluded. 고객이 물어볼 만한 질문 3개도 제안합니다.
JSON만 출력: {"columns":[{"column":"","role":"","label":"","unit":"","valueMap":{}}],"questions":["","",""]}`;

/** AI 초안. 키가 없거나 실패하면 규칙 초안을 그대로 돌려준다(draftedBy: "rules"). */
export async function draftWithAi(
  columns: ColumnInfo[],
  rows: Record<string, unknown>[],
  table: string,
  openaiKey: string | null,
): Promise<Draft> {
  const rules = draftColumnRoles(columns, rows);
  if (!openaiKey) return rules;
  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            table,
            columns: columns.map((c) => ({ name: c.name, type: c.type })),
            sampleRows: rows.slice(0, 3),
            rulesDraft: rules.columns.map((c) => ({ column: c.column, role: c.role, label: c.label, unit: c.unit, personal: c.personal })),
          }),
        },
      ],
    }, { signal: AbortSignal.timeout(20000) });
    const parsed = JSON.parse(completion.choices[0].message.content ?? "{}") as {
      columns?: { column?: string; role?: string; label?: string; unit?: string; valueMap?: Record<string, string> }[];
      questions?: string[];
    };
    if (!Array.isArray(parsed.columns)) return rules;
    const byName = new Map(parsed.columns.map((c) => [String(c.column ?? ""), c]));
    const merged = rules.columns.map((c) => {
      const ai = byName.get(c.column);
      if (!ai) return c;
      const role = ROLES.includes(ai.role as ColumnRole) ? (ai.role as ColumnRole) : c.role;
      return {
        ...c,
        // 개인정보 추정 컬럼은 AI가 body라고 해도 제외를 유지한다(사용자가 직접 켠다).
        role: c.personal ? "excluded" : role,
        label: typeof ai.label === "string" && ai.label.trim() ? ai.label.trim().slice(0, 40) : c.label,
        unit: typeof ai.unit === "string" ? ai.unit.trim().slice(0, 10) : c.unit,
        valueMap:
          ai.valueMap && typeof ai.valueMap === "object" && Object.keys(ai.valueMap).length
            ? Object.fromEntries(Object.entries(ai.valueMap).slice(0, 50).map(([k, v]) => [String(k).slice(0, 50), String(v).slice(0, 50)]))
            : c.valueMap,
      };
    });
    // title·key는 정확히 하나씩. AI가 어겼으면 규칙 초안으로 되돌린다.
    if (merged.filter((c) => c.role === "title").length !== 1 || merged.filter((c) => c.role === "key").length !== 1) return rules;
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim().slice(0, 120)).slice(0, 3)
      : [];
    return { columns: merged, questions: questions.length === 3 ? questions : rules.questions, draftedBy: "ai" };
  } catch {
    return rules;
  }
}
