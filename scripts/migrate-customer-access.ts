import sql from "../lib/neon";
import { createAccessSchema, type AccessDatabase } from "../lib/access/schema";
import { inspectAccessMigration, migrateLegacyAccess, MigrationBlocked } from "../lib/access/migration";

async function main() {
  const args=process.argv.slice(2);
  if (args.some(a=>a!=="--apply")) throw new Error("사용법: migrate-customer-access.ts [--apply]");
  if (!args.includes("--apply")) {
    const {tenants,checks}=await inspectAccessMigration(sql);
    console.log(JSON.stringify({mode:"read-only",tenantsInspected:tenants.length,checks,
      readyForMigration:checks.length===0,note:"새 테이블과 데이터는 변경하지 않았습니다. 기존 신규 계정과의 충돌은 적용 트랜잭션에서 추가 검사합니다."},null,2));
    if (checks.length) process.exitCode=1;
    return;
  }
  const result=await sql.begin("isolation level serializable",async tx=>{
    const db=tx as unknown as AccessDatabase;
    await db`SELECT pg_advisory_xact_lock(180621,1)`;
    const preflight=await inspectAccessMigration(db);
    if(preflight.checks.length)throw new MigrationBlocked(preflight.checks);
    await createAccessSchema(db);
    return migrateLegacyAccess(db);
  });
  console.log(JSON.stringify({mode:"applied",...result,note:"기존 에이전시 인증은 유지됩니다. 고객사 상담함 새 버전·서브도메인·확인 메일 설정을 함께 검증하세요."},null,2));
}
main().catch(e=>{
  // postgres errors may contain credential-bearing failed-row detail; never print raw DB errors.
  console.error(e instanceof MigrationBlocked?e.message:"이관 실패. 트랜잭션을 롤백했습니다. DB 연결·스키마·제약 충돌을 비밀값을 제외하고 확인하세요.");
  process.exitCode=1;
}).finally(()=>sql.end());
