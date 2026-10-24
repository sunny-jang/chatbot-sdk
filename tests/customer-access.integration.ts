import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "../lib/neon";
import { createAccessSchema, type AccessDatabase } from "../lib/access/schema";
import { migrateLegacyAccess, MigrationBlocked } from "../lib/access/migration";
import { listAccessibleCustomers,resolveBotAccess,resolveCustomerAccess } from "../lib/access/queries";

async function main(){
  if(process.env.ACCESS_DB_CHECK!=="1"){
    console.log("미실행: ACCESS_DB_CHECK=1로 격리 스키마 DB 검증을 실행합니다. 모든 DDL·데이터는 롤백합니다.");return;
  }
  const rollback=new Error("test rollback");
  try{await sql.begin(async tx=>{
    const db=tx as unknown as AccessDatabase,schema="qa_access_"+randomUUID().replaceAll("-","");
    await tx`CREATE SCHEMA ${tx(schema)}`;
    await tx`SET LOCAL search_path TO ${tx(schema)}, pg_catalog`;
    await tx`CREATE TABLE tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT,password_hash TEXT,
      oauth_provider TEXT,oauth_sub TEXT,is_admin BOOLEAN,api_key TEXT)`;
    await tx`CREATE TABLE bots(id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),public_token TEXT)`;
    await tx`CREATE TABLE chat_sessions(id TEXT PRIMARY KEY)`;
    await tx`CREATE TABLE chat_messages(id TEXT PRIMARY KEY)`;
    await tx`INSERT INTO tenants VALUES('a','파트너 A','Owner@EXAMPLE.com','hash-original','google','subject-a',TRUE,'key-a'),
      ('b','파트너 B','other@example.com',NULL,NULL,NULL,FALSE,'key-b')`;
    await tx`INSERT INTO bots VALUES('bot-a','a','token-original'),('bot-b','b','token-b')`;
    await createAccessSchema(db);
    const first=await migrateLegacyAccess(db);
    assert.deepEqual(first,{tenantsInspected:2,usersCreated:2,customersCreated:2,botsLinked:2});
    // Idempotent DDL and data migration, including preservation of credentials and identifiers.
    await createAccessSchema(db);
    assert.deepEqual(await migrateLegacyAccess(db),{tenantsInspected:2,usersCreated:0,customersCreated:0,botsLinked:0});
    const [a]=await tx`SELECT * FROM users WHERE legacy_tenant_id='a'`;
    const [b]=await tx`SELECT * FROM users WHERE legacy_tenant_id='b'`;
    const [ca]=await tx`SELECT id FROM customers WHERE tenant_id='a'`;
    const [cb]=await tx`SELECT id FROM customers WHERE tenant_id='b'`;
    assert.equal(a.email,'owner@example.com');assert.equal(a.password_hash,'hash-original');
    assert.equal(a.email_verified_at,null); // Existing Google linkage alone is not proof of verified email.
    assert.equal(a.is_platform_admin,true);
    assert.equal((await tx`SELECT public_token FROM bots WHERE id='bot-a'`)[0].public_token,'token-original');
    assert.equal((await tx`SELECT api_key FROM tenants WHERE id='a'`)[0].api_key,'key-a');
    assert.equal((await resolveBotAccess(db,a.id,'bot-a','partner.secrets'))?.role,'owner');
    assert.equal(await resolveBotAccess(db,a.id,'bot-b','support.read'),null); // Master flag does not bypass scope.
    await tx`INSERT INTO users(id,name,email) VALUES('agent','상담사','agent@example.com')`;
    await tx`INSERT INTO customer_memberships(customer_id,user_id,role) VALUES(${ca.id},'agent','admin'),(${cb.id},'agent','agent')`;
    assert.equal((await resolveCustomerAccess(db,'agent',ca.id,'knowledge.manage'))?.role,'admin');
    assert.equal(await resolveCustomerAccess(db,'agent',cb.id,'knowledge.manage'),null);
    assert.equal((await resolveBotAccess(db,'agent','bot-b','support.work'))?.role,'agent');
    assert.equal(await resolveBotAccess(db,'agent','bot-b','partner.secrets'),null);
    await tx`UPDATE customer_memberships SET status='revoked' WHERE user_id='agent' AND customer_id=${cb.id}`;
    assert.equal(await resolveBotAccess(db,'agent','bot-b','support.read'),null);
    assert.equal((await listAccessibleCustomers(db,'agent')).length,1);
    // Unassigned legacy bots remain compatible with old writers but fail closed for new member access.
    await tx`INSERT INTO bots(id,tenant_id,public_token) VALUES('unassigned','a','unassigned-token')`;
    assert.equal(await resolveBotAccess(db,'agent','unassigned','support.read'),null);
    // Cross-partner customer assignment is also rejected at the database layer.
    let rejected=false;
    try{await tx.savepoint(async sp=>{await sp`UPDATE bots SET customer_id=${cb.id} WHERE id='bot-a'`;});}
    catch{rejected=true;}assert.equal(rejected,true);
    await tx`UPDATE users SET password_hash='new-hash',is_platform_admin=FALSE WHERE id=${a.id}`;
    await tx`UPDATE partner_memberships SET status='revoked' WHERE user_id=${a.id}`;
    await migrateLegacyAccess(db);
    assert.equal((await tx`SELECT password_hash FROM users WHERE id=${a.id}`)[0].password_hash,'new-hash');
    assert.equal(await resolveCustomerAccess(db,a.id,ca.id,'support.read'),null);
    await tx`UPDATE users SET status='disabled' WHERE id=${b.id}`;
    assert.equal((await listAccessibleCustomers(db,b.id)).length,0);
    await tx`UPDATE customers SET status='inactive' WHERE id=${ca.id}`;
    assert.equal(await resolveCustomerAccess(db,'agent',ca.id,'support.read'),null);
    // A normalized-email collision blocks the entire migration before writes.
    await tx`INSERT INTO tenants(id,name,email) VALUES('duplicate','충돌','OWNER@example.com')`;
    await assert.rejects(()=>migrateLegacyAccess(db),MigrationBlocked);
    assert.equal((await tx`SELECT count(*)::int AS n FROM users WHERE legacy_tenant_id='duplicate'`)[0].n,0);
    console.log("이관 멱등성·자격증명/공개 토큰 보존·고객사 역할 분리·즉시 회수·비활성 차단·교차 고객사 FK·충돌 차단 검증 통과 (전체 롤백)");
    throw rollback;
  });}catch(e){if(e!==rollback)throw e;}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>sql.end());
