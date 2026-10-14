import { createHash } from "node:crypto";
import { OperationError } from "./operations/input";
import { excludedProactivePath } from "./proactive";

export type SectionSignal = { id: string; title: string; summary: string; seconds: number; returns: number };
export type BehaviorSummary = { visitId: string; evaluationId: string; path: string; currentId: string; activeSeconds: number; sections: SectionSignal[] };
export type ProactiveOffer = { decision: "offer" | "skip"; message: string; intent: string; discoveryGoal: string; sourceIds: string[]; reason: string };

export function cleanPublicText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\b\S+@\S+\.\S+\b/g, "[연락처 제외]").replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[연락처 제외]").replace(/https?:\/\/\S+/g, "[주소 제외]").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function validateBehavior(value: unknown): BehaviorSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationError("올바른 행동 요약이 아닙니다.");
  const v = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(String(v.visitId)) || !uuid.test(String(v.evaluationId))) throw new OperationError("방문 식별자를 확인해주세요.");
  if (typeof v.path !== "string" || !v.path.startsWith("/") || v.path.length > 200 || /[?#@]/.test(v.path)) throw new OperationError("페이지 경로를 확인해주세요.");
  if (!Array.isArray(v.sections) || v.sections.length < 1 || v.sections.length > 6) throw new OperationError("관심 구간을 확인해주세요.");
  const sections = v.sections.map((raw): SectionSignal => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OperationError("구간을 확인해주세요.");
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !/^[\w-]{1,64}$/.test(s.id)) throw new OperationError("구간 식별자를 확인해주세요.");
    if (typeof s.seconds !== "number" || !Number.isFinite(s.seconds) || s.seconds < 0 || s.seconds > 3600) throw new OperationError("노출 시간을 확인해주세요.");
    const title = cleanPublicText(s.title, 100);
    if (!title) throw new OperationError("구간 제목이 없습니다.");
    return { id: s.id, title, summary: cleanPublicText(s.summary, 200), seconds: Math.floor(s.seconds), returns: typeof s.returns === "number" ? Math.max(0, Math.min(20, Math.floor(s.returns))) : 0 };
  });
  if (new Set(sections.map(s => s.id)).size !== sections.length || !sections.some(s => s.id === v.currentId)) throw new OperationError("현재 구간을 확인해주세요.");
  if (typeof v.activeSeconds !== "number" || !Number.isFinite(v.activeSeconds) || v.activeSeconds < 0 || v.activeSeconds > 3600) throw new OperationError("체류 시간을 확인해주세요.");
  return { visitId: String(v.visitId), evaluationId: String(v.evaluationId), path: v.path, currentId: String(v.currentId), activeSeconds: Math.floor(v.activeSeconds), sections };
}

export function candidateReason(summary: BehaviorSummary, delay = 30, excluded = "") {
  if (excludedProactivePath(summary.path, excluded)) return "excluded_page";
  if (summary.activeSeconds < Math.max(30, delay)) return "short_visit";
  const current = summary.sections.find(s => s.id === summary.currentId)!;
  if (current.seconds < 15) return "short_section";
  return "eligible";
}

export function behaviorHash(summary: BehaviorSummary) {
  return createHash("sha256").update(JSON.stringify({ path: summary.path, currentId: summary.currentId, sections: summary.sections.map(s => ({ id: s.id, title: s.title, summary: s.summary })).sort((a,b)=>a.id.localeCompare(b.id)) })).digest("hex");
}

export function validateOffer(value: unknown, sourceIds: string[]): ProactiveOffer {
  const skip = (reason: string): ProactiveOffer => ({ decision: "skip", message: "", intent: "", discoveryGoal: "", sourceIds: [], reason });
  if (!value || typeof value !== "object") return skip("invalid_model_output");
  const v = value as Record<string, unknown>;
  if (v.decision !== "offer") return skip("not_helpful");
  const message = cleanPublicText(v.message, 100);
  const intent = typeof v.intent === "string" && /^[a-z_]{1,50}$/.test(v.intent) ? v.intent : "discover_need";
  const ids = Array.isArray(v.sourceIds) ? [...new Set(v.sourceIds.filter((id): id is string => typeof id === "string"))] : [];
  if (!message || message.length > 60 || !/[?？]$/.test(message) || !ids.length || ids.some(id => !sourceIds.includes(id))) return skip("invalid_evidence");
  if (/\d|@|https?:|[<>]|계속.*보|\d+번|오래.*보/.test(message)) return skip("unsafe_message");
  return { decision: "offer", message, intent, discoveryGoal: cleanPublicText(v.discoveryGoal, 140), sourceIds: ids, reason: "grounded_question" };
}

export function rankKnowledge(sections: SectionSignal[], rows: { id: string; title: string; content: string }[]) {
  const query = sections.map(s => `${s.title} ${s.summary}`).join(" ").toLowerCase();
  const words = [...new Set(query.match(/[a-z]{2,}|[가-힣]{2,}/g) || [])];
  const tokens = new Set(words.flatMap(w => [w, ...Array.from({length:Math.max(0,w.length-1)},(_,i)=>w.slice(i,i+2))]));
  return rows.flatMap(row => {
    const chunks = row.content.match(/[\s\S]{1,800}/g) || [];
    return chunks.map(content => {
      const text = `${row.title} ${content}`.toLowerCase();
      const matches = [...tokens].filter(t => text.includes(t));
      return { id: row.id, title: cleanPublicText(row.title,100), content: cleanPublicText(content,800), score: matches.length };
    });
  }).filter(r => r.score >= 3).sort((a,b)=>b.score-a.score).filter((r,i,all)=>all.findIndex(p=>p.id===r.id)===i).slice(0,3);
}
