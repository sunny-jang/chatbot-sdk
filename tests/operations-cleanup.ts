/** 운영 기능 검증에서 만든 고유 접두사와 이름을 가진 데이터만 정리합니다. */
import sql from "../lib/neon";
import { rm } from "node:fs/promises";
async function main() {
  if (process.env.OPERATIONS_TEST_CLEANUP !== "1")
    throw Error("검증 데이터 정리에는 OPERATIONS_TEST_CLEANUP=1이 필요합니다.");
  try {
    const tenants =
      await sql`SELECT id FROM tenants WHERE id LIKE 'operations-test-%' AND name IN ('기능 검증 전용','접근 격리 검증')`;
    const ids = tenants.map((t) => String(t.id));
    if (ids.length)
      await sql.begin(async (tx) => {
        const bots =
          await tx`SELECT id FROM bots WHERE tenant_id=ANY(${ids}::text[])`;
        const botIds = bots.map((b) => String(b.id));
        if (botIds.length) {
          await tx`DELETE FROM chat_logs WHERE bot_id=ANY(${botIds}::text[])`;
          await tx`DELETE FROM bots WHERE id=ANY(${botIds}::text[])`;
        }
        await tx`DELETE FROM tenants WHERE id=ANY(${ids}::text[])`;
      });
    await rm("/tmp/ideal-ai-operations-fixture.json", { force: true });
    console.log(
      `검증 계정 ${ids.length}개 및 연결된 검증 데이터를 정리했습니다.`,
    );
  } finally {
    await sql.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
