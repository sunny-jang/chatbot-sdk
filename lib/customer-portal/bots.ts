import { randomUUID } from "node:crypto";
import type { AccessDatabase } from "../access/schema";
import type { Permission } from "../access/policy";
import { resolveBotAccess } from "../access/queries";
import { lockAccess } from "./auth";
import { PortalError, text } from "./input";
import { widgetColor, widgetTitle } from "../widget-presentation";
import { normalizeSupportHours } from "../supportHours";
export async function customerBot(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  botId: string,
  permission: Permission = "bot.read",
  lock = false,
) {
  if (lock) await lockAccess(db, userId, customerId, permission);
  const grant = await resolveBotAccess(db, userId, botId, permission);
  if (!grant || grant.customer_id !== customerId)
    throw new PortalError("챗봇을 찾을 수 없습니다.", 404);
  const [bot] =
    await db`SELECT id,name,type,model,system_prompt,widget_title,widget_color,greeting_message,logo_url,support_mode,support_hours,force_unattended,qa_handoff_always,public_token FROM bots WHERE id=${botId} AND customer_id=${customerId} AND tenant_id=${grant.tenant_id}`;
  if (!bot) throw new PortalError("챗봇을 찾을 수 없습니다.", 404);
  return { bot, grant };
}
async function audit(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  tenantId: string,
  action: string,
  target: string,
) {
  await db`INSERT INTO access_audit_logs(id,actor_user_id,tenant_id,customer_id,action,target_id,outcome) VALUES(${randomUUID()},${userId},${tenantId},${customerId},${action},${target},'success')`;
}
export async function configureCustomerBot(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  botId: string,
  input: Record<string, unknown>,
) {
  const { bot, grant } = await customerBot(
    db,
    userId,
    customerId,
    botId,
    "bot.configure",
    true,
  );
  const name =
    input.name === undefined
      ? String(bot.name)
      : text(input.name, "챗봇 이름", 100);
  const title =
    input.widget_title === undefined
      ? bot.widget_title
      : input.widget_title === null || input.widget_title === ""
        ? null
        : widgetTitle(input.widget_title);
  if (input.widget_title && !title)
    throw new PortalError("위젯 제목은 100자 이내 일반 텍스트로 입력해주세요.");
  const color =
    input.widget_color === undefined
      ? bot.widget_color
      : widgetColor(input.widget_color);
  if (input.widget_color !== undefined && !color)
    throw new PortalError("색상은 #RGB 또는 #RRGGBB로 입력해주세요.");
  if (
    input.support_mode !== undefined &&
    !["hybrid", "unattended"].includes(String(input.support_mode))
  )
    throw new PortalError("상담 모드를 확인해주세요.");
  if (
    input.force_unattended !== undefined &&
    typeof input.force_unattended !== "boolean"
  )
    throw new PortalError("무인 운영 설정을 확인해주세요.");
  const prompt =
    input.system_prompt === undefined
      ? bot.system_prompt
      : input.system_prompt === ""
        ? null
        : text(input.system_prompt, "응대 지침", 10000);
  const greeting =
    input.greeting_message === undefined
      ? bot.greeting_message
      : input.greeting_message === ""
        ? null
        : text(input.greeting_message, "인사말", 1000);
  const hours =
    input.support_hours === undefined
      ? bot.support_hours
      : normalizeSupportHours(input.support_hours);
  await db`UPDATE bots SET name=${name},widget_title=${title},widget_color=${color},system_prompt=${prompt},greeting_message=${greeting},support_mode=${input.support_mode === undefined ? bot.support_mode : String(input.support_mode)},support_hours=${hours ? db.json(hours) : null},force_unattended=${input.force_unattended === undefined ? Boolean(bot.force_unattended) : Boolean(input.force_unattended)} WHERE id=${botId} AND customer_id=${customerId}`;
  await audit(db, userId, customerId, grant.tenant_id, "bot.configure", botId);
}
export type KnowledgeKind = "docs" | "qa" | "folders" | "qa-folders";
export function knowledgeKind(value: string): KnowledgeKind {
  if (!["docs", "qa", "folders", "qa-folders"].includes(value))
    throw new PortalError("기능을 찾을 수 없습니다.", 404);
  return value as KnowledgeKind;
}
export async function listKnowledge(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  botId: string,
  kind: KnowledgeKind,
) {
  await customerBot(db, userId, customerId, botId, "knowledge.manage");
  if (kind === "docs")
    return db`SELECT id,bot_id,folder_id,title,content,created_at FROM documents WHERE bot_id=${botId} ORDER BY created_at DESC,id`;
  if (kind === "qa")
    return db`SELECT id,bot_id,folder_id,question,answer,created_at FROM qa_pairs WHERE bot_id=${botId} ORDER BY created_at DESC,id`;
  if (kind === "folders")
    return db`SELECT id,name FROM doc_folders WHERE bot_id=${botId} ORDER BY name,id`;
  return db`SELECT id,name FROM qa_folders WHERE bot_id=${botId} ORDER BY name,id`;
}
export async function mutateKnowledge(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  botId: string,
  kind: KnowledgeKind,
  method: string,
  input: Record<string, unknown>,
  itemId: string | null,
  embedding: number[] | null,
) {
  const { grant } = await customerBot(
    db,
    userId,
    customerId,
    botId,
    "knowledge.manage",
    true,
  );
  const folderKind = kind === "folders" || kind === "qa-folders";
  const table =
    kind === "docs"
      ? "documents"
      : kind === "qa"
        ? "qa_pairs"
        : kind === "folders"
          ? "doc_folders"
          : "qa_folders";
  const target = itemId || randomUUID();
  if (itemId) {
    const rows =
      await db`SELECT id FROM ${db(table)} WHERE id=${itemId} AND bot_id=${botId} FOR UPDATE`;
    if (!rows[0]) throw new PortalError("항목을 찾을 수 없습니다.", 404);
  }
  if (method === "DELETE") {
    if (!itemId) throw new PortalError("항목을 확인해주세요.");
    if (folderKind) {
      const records = kind === "folders" ? "documents" : "qa_pairs";
      await db`UPDATE ${db(records)} SET folder_id=NULL WHERE bot_id=${botId} AND folder_id=${itemId}`;
    }
    await db`DELETE FROM ${db(table)} WHERE id=${itemId} AND bot_id=${botId}`;
  } else if (folderKind) {
    const name = text(input.name, "폴더 이름", 100);
    if (itemId)
      await db`UPDATE ${db(table)} SET name=${name} WHERE id=${itemId} AND bot_id=${botId}`;
    else
      await db`INSERT INTO ${db(table)}(id,bot_id,name) VALUES(${target},${botId},${name})`;
  } else {
    const folderId = input.folder_id
      ? text(input.folder_id, "폴더", 200)
      : null;
    if (folderId) {
      const folders = kind === "docs" ? "doc_folders" : "qa_folders";
      const [folder] =
        await db`SELECT id FROM ${db(folders)} WHERE id=${folderId} AND bot_id=${botId}`;
      if (!folder) throw new PortalError("이 챗봇의 폴더를 선택해주세요.", 404);
    }
    if (
      !embedding ||
      !embedding.length ||
      embedding.some((v) => !Number.isFinite(v))
    )
      throw new PortalError("지식 검색 데이터를 준비하지 못했습니다.", 503);
    if (kind === "docs") {
      const title = text(input.title, "제목", 300),
        content = text(input.content, "본문", 50000);
      if (itemId)
        await db`UPDATE documents SET title=${title},content=${content},folder_id=${folderId},embedding=${JSON.stringify(embedding)} WHERE id=${itemId} AND bot_id=${botId}`;
      else
        await db`INSERT INTO documents(id,bot_id,title,content,folder_id,embedding) VALUES(${target},${botId},${title},${content},${folderId},${JSON.stringify(embedding)})`;
    } else {
      const question = text(input.question, "질문", 2000),
        answer = text(input.answer, "답변", 20000);
      if (itemId)
        await db`UPDATE qa_pairs SET question=${question},answer=${answer},folder_id=${folderId},embedding=${JSON.stringify(embedding)} WHERE id=${itemId} AND bot_id=${botId}`;
      else
        await db`INSERT INTO qa_pairs(id,bot_id,question,answer,folder_id,embedding) VALUES(${target},${botId},${question},${answer},${folderId},${JSON.stringify(embedding)})`;
    }
  }
  await audit(
    db,
    userId,
    customerId,
    grant.tenant_id,
    "knowledge." + method.toLowerCase(),
    target,
  );
  return { id: target, ok: true };
}
