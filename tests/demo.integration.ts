import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import type { AccessDatabase } from "../lib/access/schema";
import { createAccessSchema } from "../lib/access/schema";
import {
  createDemo,
  readPublicDemo,
  reserveDemoTurn,
  reserveDemoModelCall,
  revokeDemo,
} from "../lib/demo/store";
async function main() {
  if (process.env.DEMO_DB_CHECK !== "1") throw Error("DEMO_DB_CHECK=1 필요");
  const url = new URL(process.env.POSTGRES_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname != "/chatbot_qa"
  )
    throw Error("로컬 QA DB만 허용");
  const rollback = new Error("rollback");
  let checks = 0;
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as AccessDatabase;
      await createAccessSchema(db);
      const suffix = randomUUID(),
        tenant = "demo-tenant-" + suffix,
        owner = "demo-owner-" + suffix,
        customer = "demo-customer-" + suffix,
        bot = "demo-bot-" + suffix;
      await tx`INSERT INTO tenants(id,name,api_key,subscription_status) VALUES(${tenant},'데모 검사',${randomUUID()},'active')`;
      await tx`INSERT INTO users(id,name,email) VALUES(${owner},'소유자',${suffix + "@example.test"})`;
      await tx`INSERT INTO partner_memberships(user_id,tenant_id) VALUES(${owner},${tenant})`;
      await tx`INSERT INTO customers(id,tenant_id,name) VALUES(${customer},${tenant},'데모 고객사')`;
      await tx`INSERT INTO bots(id,tenant_id,customer_id,name,type) VALUES(${bot},${tenant},${customer},'데모 봇','qa')`;
      const created = await createDemo(
        db,
        owner,
        tenant,
        customer,
        bot,
        "https://example.com",
        24,
      );
      assert.equal((await readPublicDemo(db, created.token)).id, created.id);
      checks++;
      const [stored] =
        await tx`SELECT token_hash FROM customer_demos WHERE id=${created.id}`;
      assert.notEqual(stored.token_hash, created.token);
      assert.equal(stored.token_hash.length, 64);
      checks++;
      const turn = await reserveDemoTurn(
        db,
        created.token,
        "session-a",
        "request-a",
        "질문",
        null,
      );
      assert.equal(turn.duplicate, false);
      checks++;
      // Static/failed-before-provider turns do not reserve paid model budget.
      await tx`INSERT INTO demo_turns(id,demo_id,session_id,request_id,payload_hash,question,state) SELECT ${suffix}||'-static-'||n,${created.id},'old',n::text,'hash','정적 질문','failed' FROM generate_series(1,1000) n`;
      await reserveDemoModelCall(db, created.token, turn.id);
      await reserveDemoModelCall(db, created.token, turn.id);
      assert.equal(
        (
          await tx`SELECT count(*)::int AS n FROM demo_turns WHERE demo_id=${created.id} AND model_started_at IS NOT NULL`
        )[0].n,
        1,
      );
      checks++;
      await tx`UPDATE demo_turns SET model_started_at=EXTRACT(EPOCH FROM NOW())::bigint WHERE demo_id=${created.id} AND id<>${turn.id}`;
      const staticTurn = await reserveDemoTurn(
        db,
        created.token,
        "static-new",
        "static-new",
        "선택 질문",
        "qa-id",
      );
      await assert.rejects(
        () => reserveDemoModelCall(db, created.token, staticTurn.id),
        { status: 429 },
      );
      assert.equal(
        (
          await tx`SELECT model_started_at FROM demo_turns WHERE id=${staticTurn.id}`
        )[0].model_started_at,
        null,
      );
      checks++;
      await tx`UPDATE demo_turns SET state='completed',reply='답변' WHERE id=${turn.id}`;
      const retry = await reserveDemoTurn(
        db,
        created.token,
        "session-a",
        "request-a",
        "질문",
        null,
      );
      assert.equal(retry.duplicate, true);
      assert.equal(retry.reply, "답변");
      checks++;
      await assert.rejects(
        () =>
          reserveDemoTurn(
            db,
            created.token,
            "session-a",
            "request-a",
            "변조",
            null,
          ),
        { status: 409 },
      );
      checks++;
      await tx`UPDATE customer_demos SET max_requests=1 WHERE id=${created.id}`;
      await assert.rejects(
        () =>
          reserveDemoTurn(
            db,
            created.token,
            "session-a",
            "request-b",
            "다음 질문",
            null,
          ),
        { status: 429 },
      );
      checks++;
      const [real] =
        await tx`SELECT (SELECT count(*) FROM chat_sessions WHERE tenant_id=${tenant})::int AS sessions,(SELECT count(*) FROM chat_logs WHERE bot_id=${bot})::int AS logs,(SELECT count(*) FROM customer_requests WHERE tenant_id=${tenant})::int AS requests`;
      assert.deepEqual([real.sessions, real.logs, real.requests], [0, 0, 0]);
      checks++;
      await revokeDemo(db, owner, tenant, created.id);
      await assert.rejects(() => readPublicDemo(db, created.token), {
        status: 410,
      });
      checks++;
      const expired = await createDemo(
        db,
        owner,
        tenant,
        customer,
        bot,
        "https://example.com",
        1,
      );
      await tx`UPDATE customer_demos SET expires_at=1 WHERE id=${expired.id}`;
      await assert.rejects(() => readPublicDemo(db, expired.token), {
        status: 410,
      });
      checks++;
      const disabled = await createDemo(
        db,
        owner,
        tenant,
        customer,
        bot,
        "https://example.com",
        1,
      );
      await tx`UPDATE users SET status='disabled' WHERE id=${owner}`;
      await assert.rejects(() => readPublicDemo(db, disabled.token), {
        status: 410,
      });
      checks++;
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  console.log(
    `데모 공유·해시·멱등·한도·운영 분리·해제·만료·소유자 회수 ${checks}개 통과. 전체 롤백.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
