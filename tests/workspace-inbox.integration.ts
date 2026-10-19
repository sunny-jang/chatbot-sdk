import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import { readSupportInbox } from "../lib/support-inbox-query";

async function main() {
  if (process.env.WORKSPACE_DB_CHECK !== "1") {
    console.log(
      "실제 DB 검증은 WORKSPACE_DB_CHECK=1로 실행합니다. 모든 검증 데이터는 롤백합니다.",
    );
    return;
  }
  const rollback = new Error("verification rollback");
  try {
    await sql.begin(async (tx) => {
      const tenant = randomUUID(),
        other = randomUUID(),
        bot = randomUUID(),
        otherBot = randomUUID();
      await tx`INSERT INTO tenants(id,name,api_key) VALUES(${tenant},'검증 전용',${randomUUID()}),(${other},'다른 검증 공간',${randomUUID()})`;
      await tx`INSERT INTO bots(id,tenant_id,name,type) VALUES(${bot},${tenant},'검증 챗봇','ai'),(${otherBot},${other},'다른 공간 챗봇','ai')`;
      const rows = Array.from({ length: 205 }, (_, i) => ({
        id: randomUUID(),
        tenant_id: tenant,
        bot_id: bot,
        status: "closed",
        customer_name: i === 0 ? "오래된 검색 고객" : `검증 고객 ${i}`,
        updated_at: 100 + i,
      }));
      const waiting = {
        id: randomUUID(),
        tenant_id: tenant,
        bot_id: bot,
        status: "waiting",
        customer_name: "오래 기다린 고객",
        updated_at: 1,
      };
      const foreign = {
        id: randomUUID(),
        tenant_id: other,
        bot_id: otherBot,
        status: "waiting",
        customer_name: "다른 공간 고객",
        updated_at: 999,
      };
      const sessions = [...rows, waiting, foreign];
      await tx`INSERT INTO chat_sessions ${tx(sessions, "id", "tenant_id", "bot_id", "status", "customer_name", "updated_at")}`;
      await tx`INSERT INTO support_handoffs ${tx(
        sessions.map((s) => ({
          id: randomUUID(),
          session_id: s.id,
          bot_id: s.bot_id,
          status: s.status,
          requested_at: s.updated_at,
        })),
        "id",
        "session_id",
        "bot_id",
        "status",
        "requested_at",
      )}`;
      await tx`INSERT INTO chat_messages(id,session_id,sender_type,content) VALUES(${randomUUID()},${rows[0].id},'customer','찾을 내용: 진짜 %_ 기호')`;
      const db = tx as unknown as typeof sql;
      const pending = await readSupportInbox(tenant, "waiting", "", "", db);
      assert.deepEqual(
        pending.map((r) => r.session_id),
        [waiting.id],
      );
      const all = await readSupportInbox(tenant, "", "", "", db);
      assert.equal(all.length, 200);
      assert.equal(all[0].session_id, waiting.id);
      const selected = await readSupportInbox(
        tenant,
        "waiting",
        "",
        rows[204].id,
        db,
      );
      assert.equal(selected[0].session_id, rows[204].id);
      assert.equal(selected.length, 2);
      const search = await readSupportInbox(tenant, "closed", "%_", "", db);
      assert.equal(search.length, 1);
      assert.equal(search[0].session_id, rows[0].id);
      const isolated = await readSupportInbox(tenant, "", "", foreign.id, db);
      assert.ok(!isolated.some((r) => r.session_id === foreign.id));
      console.log(
        "200건 초과 대기 누락·선택 상담 유지·전체 범위 검색·문자 그대로 검색·공간 격리 검증 통과",
      );
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
}
main().finally(() => sql.end());
