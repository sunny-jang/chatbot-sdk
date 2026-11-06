/**
 * 답변 정확도 평가 (로컬 QA DB 전용).
 *
 * 자료 파일(snapshot JSON: bots·docs·qa·logs)을 QA DB의 평가용 계정에 넣고, 정답이 정해진 질문 세트를 만들어
 * 실제 채팅 API(/api/chat/{botId})로 질문한 뒤 채점한다. 답변 경로(Q&A 매칭·문서 검색·프롬프트)는 운영 코드 그대로다.
 *
 *   node --env-file=<qa env> --import tsx scripts/eval/answer-accuracy.ts <명령> --dir <작업 폴더> [--snapshot <파일>] [--base http://localhost:3013]
 *   명령: load | generate | run | judge | report | cleanup | all
 *
 * - OPENAI_API_KEY: 질문 생성·채점용, 그리고 평가용 계정의 키(QA DB에 암호화 저장, cleanup에서 삭제).
 * - 자료·질문·답변 파일은 고객 자료를 담으므로 저장소가 아닌 작업 폴더(--dir)에만 쓴다.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import sql from "../../lib/neon";
import { encrypt } from "../../lib/crypto";

const TENANT = "eval-accuracy";
const GEN_MODEL = process.env.EVAL_GEN_MODEL || "gpt-4o";
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gpt-4o";
const MAX_DOC_QUESTIONS = Number(process.env.EVAL_MAX_DOC_QUESTIONS || 20);
const OUT_OF_SCOPE = Number(process.env.EVAL_OUT_OF_SCOPE || 6);

type Bot = { id: string; name: string; type: "qa" | "ai"; model: string | null; system_prompt: string | null; support_mode?: string; qa_handoff_always?: boolean };
type Doc = { id: string; bot_id: string; title: string; content: string; embedding?: string | null };
type Qa = { id: string; bot_id: string; question: string; answer: string; embedding?: string | null };
type Snapshot = { bots: Bot[]; docs: Doc[]; qa: Qa[]; logs?: { bot_id: string; user_message: string }[] };
type Case = {
  id: string;
  botId: string;
  kind: "qa_paraphrase" | "doc_fact" | "out_of_scope" | "real_log";
  question: string;
  expectedQaId?: string;
  expectedFacts?: string;
  sourceDocId?: string;
};
type RunRow = Case & { status: number; reply: string | null; usedDocs: { title: string; score: number }[]; matchedQaId: string | null; matchScore: number | null; error?: string };
type Verdict = "correct" | "partial" | "incorrect" | "hallucinated" | "declined_ok" | "declined_wrong";
type Judged = RunRow & { verdict: Verdict; reason: string };

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const dir = arg("dir");
const base = arg("base", "http://localhost:3013")!;
const file = (name: string) => `${dir}/${name}`;
const readJson = async <T,>(name: string) => JSON.parse(await readFile(file(name), "utf8")) as T;
const writeJson = (name: string, data: unknown) => writeFile(file(name), JSON.stringify(data, null, 2), { mode: 0o600 });

function guardLocal() {
  const u = new URL(process.env.POSTGRES_URL || "");
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || u.pathname !== "/chatbot_qa") throw Error("전용 로컬 QA DB만 허용");
  const b = new URL(base);
  if (!["localhost", "127.0.0.1"].includes(b.hostname)) throw Error("로컬 QA 서버만 허용");
  if (!process.env.OPENAI_API_KEY) throw Error("OPENAI_API_KEY 필요");
  if (!dir) throw Error("--dir 필요");
}
const openai = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tokenOf = (botId: string) => "eval-" + botId.replace(/[^a-z0-9]/gi, "").slice(0, 24);

async function json<T>(model: string, system: string, user: string): Promise<T> {
  const r = await openai().chat.completions.create({ model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  return JSON.parse(r.choices[0].message.content || "{}") as T;
}

/** 자료 파일을 QA DB 평가용 계정에 넣는다. 임베딩이 없으면 운영과 같은 모델로 만든다. */
async function load() {
  const snapshot = JSON.parse(await readFile(arg("snapshot")!, "utf8")) as Snapshot;
  const ids = snapshot.bots.map((b) => b.id);
  const client = openai();
  const embed = async (texts: string[]) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const r = await client.embeddings.create({ model: "text-embedding-3-small", input: texts.slice(i, i + 100).map((t) => t.slice(0, 8000)) });
      out.push(...r.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  };
  const docNeed = snapshot.docs.filter((d) => !d.embedding);
  const qaNeed = snapshot.qa.filter((q) => !q.embedding);
  // 운영 업로드와 같게 문서는 본문 앞 8,000자, Q&A는 질문으로 임베딩한다.
  (await embed(docNeed.map((d) => d.content))).forEach((v, i) => (docNeed[i].embedding = JSON.stringify(v)));
  (await embed(qaNeed.map((q) => q.question))).forEach((v, i) => (qaNeed[i].embedding = JSON.stringify(v)));
  await sql.begin(async (tx) => {
    await tx`INSERT INTO tenants(id,name,api_key,plan,subscription_status,openai_api_key) VALUES(${TENANT},'정확도 평가',${"eval-" + randomUUID()},'pro','active',${encrypt(process.env.OPENAI_API_KEY!)})
      ON CONFLICT(id) DO UPDATE SET openai_api_key=EXCLUDED.openai_api_key, plan='pro', subscription_status='active'`;
    await tx`DELETE FROM chat_logs WHERE bot_id = ANY(${ids}::text[])`;
    await tx`DELETE FROM documents WHERE bot_id = ANY(${ids}::text[])`;
    await tx`DELETE FROM qa_pairs WHERE bot_id = ANY(${ids}::text[])`;
    for (const b of snapshot.bots) {
      await tx`INSERT INTO bots(id,tenant_id,name,type,model,system_prompt,public_token,support_mode,qa_handoff_always)
        VALUES(${b.id},${TENANT},${b.name},${b.type},${b.model || "gpt-4o-mini"},${b.system_prompt},${tokenOf(b.id)},'unattended',${b.qa_handoff_always ?? true})
        ON CONFLICT(id) DO UPDATE SET tenant_id=${TENANT}, name=EXCLUDED.name, type=EXCLUDED.type, model=EXCLUDED.model, system_prompt=EXCLUDED.system_prompt, public_token=EXCLUDED.public_token, support_mode='unattended', customer_id=NULL`;
    }
    for (const d of snapshot.docs) await tx`INSERT INTO documents(id,bot_id,title,content,embedding) VALUES(${d.id},${d.bot_id},${d.title},${d.content},${d.embedding!})`;
    for (const q of snapshot.qa) await tx`INSERT INTO qa_pairs(id,bot_id,question,answer,embedding) VALUES(${q.id},${q.bot_id},${q.question},${q.answer},${q.embedding!})`;
  });
  await writeJson("bots.json", snapshot.bots.map((b) => ({ id: b.id, name: b.name, type: b.type })));
  console.log(`불러옴: 챗봇 ${snapshot.bots.length} · 문서 ${snapshot.docs.length} · Q&A ${snapshot.qa.length} (새 임베딩 ${docNeed.length + qaNeed.length}건)`);
}

const GEN_RULES = "한국어로, 실제 고객이 채팅창에 치는 말투로 쓰세요. 원문 문장을 그대로 베끼지 말고 표현을 바꾸세요. 너무 길게 쓰지 마세요(한두 문장).";

/** 정답이 정해진 질문 세트: Q&A 바꿔 말하기, 문서 사실 질문, 범위 밖 질문, 실제 고객 질문. */
async function generate() {
  const snapshot = JSON.parse(await readFile(arg("snapshot")!, "utf8")) as Snapshot;
  const cases: Case[] = [];
  for (const bot of snapshot.bots) {
    const qa = snapshot.qa.filter((q) => q.bot_id === bot.id);
    const docs = snapshot.docs.filter((d) => d.bot_id === bot.id);
    for (let i = 0; i < qa.length; i += 20) {
      const chunk = qa.slice(i, i + 20);
      const r = await json<{ items: { id: string; question: string }[] }>(GEN_MODEL,
        `등록된 FAQ 질문을 고객이 실제로 물어볼 법한 다른 표현으로 바꿉니다. ${GEN_RULES} 같은 뜻을 유지하되 핵심 단어 일부는 동의어로 바꾸세요. JSON {"items":[{"id":"","question":""}]}`,
        JSON.stringify(chunk.map((q) => ({ id: q.id, question: q.question, answer: q.answer.slice(0, 400) }))));
      for (const it of r.items || []) if (chunk.some((q) => q.id === it.id)) cases.push({ id: randomUUID(), botId: bot.id, kind: "qa_paraphrase", question: it.question, expectedQaId: it.id });
    }
    const picked = docs.slice().sort((a, b) => b.content.length - a.content.length).slice(0, MAX_DOC_QUESTIONS);
    for (const d of picked) {
      const r = await json<{ question: string; facts: string }>(GEN_MODEL,
        `아래 문서 한 개만 읽고 답할 수 있는 구체적인 질문 하나와 정답 핵심 사실을 만듭니다. ${GEN_RULES} 답이 문서에 분명히 있는 내용(수치·조건·방법·이름 등)을 묻고, 정답 핵심 사실은 한두 문장으로 쓰세요. JSON {"question":"","facts":""}`,
        `제목: ${d.title}\n\n${d.content.slice(0, 6000)}`);
      if (r.question && r.facts) cases.push({ id: randomUUID(), botId: bot.id, kind: "doc_fact", question: r.question, expectedFacts: r.facts, sourceDocId: d.id });
    }
    const topics = [...qa.map((q) => q.question), ...docs.map((d) => d.title)].slice(0, 60).join("\n");
    const oos = await json<{ items: string[] }>(GEN_MODEL,
      `이 챗봇의 등록 자료로는 답할 수 없는 질문을 ${OUT_OF_SCOPE}개 만듭니다. 절반은 같은 업종이라 그럴듯하지만 자료에 없는 구체 정보(가격·일정·재고·개인 상황 등), 절반은 업무와 무관한 질문입니다. ${GEN_RULES} JSON {"items":[""]}`,
      `챗봇: ${bot.name}\n등록 자료 주제:\n${topics}`);
    for (const q of (oos.items || []).slice(0, OUT_OF_SCOPE)) cases.push({ id: randomUUID(), botId: bot.id, kind: "out_of_scope", question: q });
    const seen = new Set<string>();
    for (const l of (snapshot.logs || []).filter((x) => x.bot_id === bot.id)) {
      const q = l.user_message.trim();
      if (q.length < 4 || q.length > 300 || seen.has(q)) continue;
      seen.add(q);
      cases.push({ id: randomUUID(), botId: bot.id, kind: "real_log", question: q });
    }
  }
  await writeJson("cases.json", cases);
  const by = (k: Case["kind"]) => cases.filter((c) => c.kind === k).length;
  console.log(`질문 ${cases.length}개: Q&A 바꿔 말하기 ${by("qa_paraphrase")} · 문서 사실 ${by("doc_fact")} · 범위 밖 ${by("out_of_scope")} · 실제 고객 질문 ${by("real_log")}`);
}

/** 실제 채팅 API로 질문한다. 질문마다 새 세션이라 앞 질문이 섞이지 않는다. 봇당 분당 60회 한도를 넘지 않게 천천히 보낸다. */
async function run() {
  const cases = await readJson<Case[]>("cases.json");
  const rows: RunRow[] = [];
  for (const [i, c] of cases.entries()) {
    const sessionId = "eval-" + randomUUID();
    let status = 0, data: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`${base}/api/chat/${c.botId}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Bot-Token": tokenOf(c.botId) }, body: JSON.stringify({ message: c.question, sessionId, history: [] }) });
      status = r.status;
      data = await r.json().catch(() => ({}));
      if (status !== 429) break;
      await new Promise((ok) => setTimeout(ok, 20000));
    }
    const [log] = await sql`SELECT qa_pair_id, qa_match_score FROM chat_logs WHERE session_id=${sessionId} ORDER BY created_at DESC LIMIT 1`;
    rows.push({ ...c, status, reply: typeof data.reply === "string" ? data.reply : null, usedDocs: (data.usedDocs as RunRow["usedDocs"]) || [], matchedQaId: log?.qa_pair_id ?? null, matchScore: log?.qa_match_score ?? null, ...(status !== 200 ? { error: String(data.error || "") } : {}) });
    if ((i + 1) % 10 === 0) console.log(`${i + 1}/${cases.length}`);
    await new Promise((ok) => setTimeout(ok, 1100));
  }
  await writeJson("runs.json", rows);
  console.log(`질문 ${rows.length}개 완료 · HTTP 오류 ${rows.filter((r) => r.status !== 200).length}`);
}

const FALLBACK_QA = "해당 질문에 대한 답변을 찾지 못했습니다";

/** Q&A 챗봇은 매칭된 항목으로 기계 채점, AI 챗봇은 원문 문서를 근거로 모델이 채점한다. */
async function judge() {
  const snapshot = JSON.parse(await readFile(arg("snapshot")!, "utf8")) as Snapshot;
  const runs = await readJson<RunRow[]>("runs.json");
  const bots = new Map(snapshot.bots.map((b) => [b.id, b]));
  const docs = new Map(snapshot.docs.map((d) => [d.id, d]));
  const out: Judged[] = [];
  for (const r of runs) {
    const bot = bots.get(r.botId)!;
    if (r.status !== 200 || r.reply === null) { out.push({ ...r, verdict: "incorrect", reason: `HTTP ${r.status} ${r.error || ""}`.trim() }); continue; }
    if (bot.type === "qa") {
      const declined = r.reply.includes(FALLBACK_QA);
      if (r.kind === "qa_paraphrase") {
        if (r.matchedQaId === r.expectedQaId) out.push({ ...r, verdict: "correct", reason: `정답 Q&A 매칭 (유사도 ${r.matchScore?.toFixed(2)})` });
        else if (declined) out.push({ ...r, verdict: "declined_wrong", reason: "답이 있는데 찾지 못함 (유사도 0.75 미만)" });
        else {
          // 다른 항목이 매칭돼도 답이 같은 내용이면 정답으로 본다(중복 Q&A).
          const exp = snapshot.qa.find((q) => q.id === r.expectedQaId)?.answer.trim();
          const same = exp && exp === r.reply.trim();
          out.push({ ...r, verdict: same ? "correct" : "incorrect", reason: same ? "다른 항목이지만 같은 답" : `다른 Q&A가 매칭됨 (유사도 ${r.matchScore?.toFixed(2)})` });
        }
        continue;
      }
      if (r.kind === "out_of_scope") { out.push({ ...r, verdict: declined ? "declined_ok" : "hallucinated", reason: declined ? "답 없음으로 안내" : `엉뚱한 Q&A로 답함 (유사도 ${r.matchScore?.toFixed(2)})` }); continue; }
    }
    // AI 챗봇(그리고 Q&A 챗봇의 실제 고객 질문): 모델 채점
    const source = r.sourceDocId ? docs.get(r.sourceDocId) : null;
    const used = r.usedDocs.map((u) => u.title);
    // AI 챗봇은 챗봇의 자료 전체(설정 문구 + 모든 문서)를 근거로 본다. 정답 문서 하나만 보면 다른 문서에 있는 사실을 지어냄으로 잘못 채점한다.
    const allDocs = () => [
      bot.system_prompt ? `[챗봇 설정 문구]\n${bot.system_prompt}` : "",
      ...(source ? [`[정답 문서: ${source.title}]\n${source.content}`] : []),
      ...snapshot.docs.filter((d) => d.bot_id === bot.id && d.id !== source?.id).map((d) => `[${d.title}]\n${d.content}`),
    ].filter(Boolean).join("\n\n").slice(0, 60000);
    const evidence = bot.type === "ai" ? allDocs() : source ? `[정답 문서: ${source.title}]\n${source.content.slice(0, 6000)}` : (bot.type === "qa"
      ? snapshot.qa.filter((q) => q.bot_id === bot.id).map((q) => `Q: ${q.question}\nA: ${q.answer.slice(0, 300)}`).join("\n\n").slice(0, 12000)
      : allDocs());
    const rubric = r.kind === "doc_fact"
      ? `정답 핵심 사실과 비교해 채점하세요. correct=핵심 사실을 정확히 포함, partial=일부만 맞거나 중요한 조건 누락, incorrect=틀림, hallucinated=자료에 없는 구체 정보(수치·약속·이름)를 지어냄, declined_wrong=자료에 답이 있는데 모른다고 함.`
      : r.kind === "out_of_scope"
        ? `이 질문은 등록 자료로 답할 수 없습니다. declined_ok=모른다고 하거나 상담·문의로 안내함(일반적인 인사·안내 수준은 괜찮음), hallucinated=자료에 없는 구체 정보(가격·일정·재고·약속 등)를 사실처럼 말함, partial=대체로 피했지만 근거 없는 단정이 섞임.`
        : `실제 고객 질문입니다. 정답은 정해져 있지 않으니 근거 자료에 비춰 채점하세요. correct=자료에 근거해 맞게 답함, partial=대체로 맞지만 빠진 부분이나 애매함, incorrect=자료와 다름, hallucinated=자료에 없는 구체 정보를 지어냄, declined_ok=자료에 없어서 모른다고/문의로 안내함(맞는 판단), declined_wrong=자료에 답이 있는데 모른다고 함.`;
    const j = await json<{ verdict: Verdict; reason: string }>(JUDGE_MODEL,
      `당신은 고객 상담 챗봇 답변을 엄격하게 채점합니다. 근거 자료 밖의 일반 상식으로 답한 부분도 구체적 사실 주장이면 hallucinated로 봅니다. ${rubric} JSON {"verdict":"correct|partial|incorrect|hallucinated|declined_ok|declined_wrong","reason":"한국어 한 문장"}`,
      `질문: ${r.question}\n${r.expectedFacts ? `정답 핵심 사실: ${r.expectedFacts}\n` : ""}챗봇 답변: ${r.reply}\n검색된 문서: ${used.join(", ") || "(없음)"}\n\n근거 자료:\n${evidence}`);
    out.push({ ...r, verdict: j.verdict || "incorrect", reason: j.reason || "" });
  }
  await writeJson("judged.json", out);
  console.log(`채점 ${out.length}건 완료`);
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "-");

/** 챗봇·질문 종류별 정확도 표와 틀린 사례 목록을 Markdown으로 쓴다. */
async function report() {
  const rows = await readJson<Judged[]>("judged.json");
  const bots = await readJson<{ id: string; name: string; type: string }[]>("bots.json");
  const kinds: [Case["kind"], string][] = [["qa_paraphrase", "등록 Q&A를 바꿔 말한 질문"], ["doc_fact", "문서에 답이 있는 질문"], ["out_of_scope", "자료에 없는 질문"], ["real_log", "실제 고객 질문"]];
  const good = (r: Judged) => r.verdict === "correct" || r.verdict === "declined_ok";
  const lines: string[] = [`# 답변 정확도 평가 결과`, ``, `질문 ${rows.length}개 · 생성 ${GEN_MODEL} · 채점 ${JUDGE_MODEL} · 답변은 각 챗봇 설정 모델`, ``, `## 요약`, ``, `| 챗봇 | 방식 | 질문 | 정답 | 부분 | 오답 | 지어냄 | 정확도 |`, `| --- | --- | --- | --- | --- | --- | --- | --- |`];
  for (const b of bots) {
    const rs = rows.filter((r) => r.botId === b.id);
    const c = (v: Verdict[]) => rs.filter((r) => v.includes(r.verdict)).length;
    lines.push(`| ${b.name} | ${b.type === "qa" ? "Q&A" : "AI"} | ${rs.length} | ${c(["correct", "declined_ok"])} | ${c(["partial"])} | ${c(["incorrect", "declined_wrong"])} | ${c(["hallucinated"])} | ${pct(rs.filter(good).length, rs.length)} |`);
  }
  lines.push(``, `## 질문 종류별`, ``, `| 챗봇 | ${kinds.map((k) => k[1]).join(" | ")} |`, `| --- | ${kinds.map(() => "---").join(" | ")} |`);
  for (const b of bots) {
    const cell = (k: Case["kind"]) => { const rs = rows.filter((r) => r.botId === b.id && r.kind === k); return rs.length ? `${pct(rs.filter(good).length, rs.length)} (${rs.filter(good).length}/${rs.length})` : "-"; };
    lines.push(`| ${b.name} | ${kinds.map((k) => cell(k[0])).join(" | ")} |`);
  }
  const qaRows = rows.filter((r) => r.kind === "qa_paraphrase" && r.matchScore !== null);
  if (qaRows.length) {
    lines.push(``, `## Q&A 매칭 유사도`, ``, `| 구간 | 정답 매칭 | 다른 Q&A |`, `| --- | --- | --- |`);
    for (const [lo, hi] of [[0.75, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 1.01]]) {
      const rs = qaRows.filter((r) => r.matchScore! >= lo && r.matchScore! < hi);
      lines.push(`| ${lo.toFixed(2)}~${Math.min(hi, 1).toFixed(2)} | ${rs.filter((r) => r.verdict === "correct").length} | ${rs.filter((r) => r.verdict !== "correct").length} |`);
    }
    lines.push(``, `답이 있는데 0.75 미만이라 "찾지 못함"이 된 질문: ${rows.filter((r) => r.kind === "qa_paraphrase" && r.verdict === "declined_wrong").length}개`);
  }
  lines.push(``, `## 틀린 사례`, ``);
  for (const r of rows.filter((x) => !good(x))) {
    const b = bots.find((x) => x.id === r.botId)!;
    lines.push(`- **${b.name} · ${kinds.find((k) => k[0] === r.kind)![1]} · ${r.verdict}**: ${r.question}`, `  - 답변: ${(r.reply || "").replace(/\s+/g, " ").slice(0, 220)}`, `  - 이유: ${r.reason}`);
  }
  await writeFile(file("report.md"), lines.join("\n"), { mode: 0o600 });
  console.log(lines.slice(0, 40).join("\n"));
}

/** 평가용 계정에 넣은 OpenAI 키를 지운다. */
async function cleanup() {
  await sql`UPDATE tenants SET openai_api_key=NULL WHERE id=${TENANT}`;
  console.log("평가용 계정의 OpenAI 키를 지웠습니다.");
}

async function main() {
  guardLocal();
  await mkdir(dir!, { recursive: true });
  const cmd = process.argv[2];
  const steps: Record<string, () => Promise<void>> = { load, generate, run, judge, report, cleanup };
  if (cmd === "all") { for (const s of ["load", "generate", "run", "judge", "report", "cleanup"]) await steps[s](); return; }
  if (!steps[cmd]) throw Error("명령: load | generate | run | judge | report | cleanup | all");
  await steps[cmd]();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => sql.end());
