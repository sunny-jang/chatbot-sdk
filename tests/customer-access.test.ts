import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPermission,canManageCustomerMember,normalizeIdentityEmail,type Permission } from "../lib/access/policy";
import { inspectLegacyIdentities } from "../lib/access/migration";

test("이메일은 trim/lowercase만 하며 Gmail 주소를 합치지 않는다",()=>{
  assert.equal(normalizeIdentityEmail(" A.B+team@Gmail.com "),"a.b+team@gmail.com");
});
const operational:Permission[]=["customer.read","support.read","support.work","requests.read","requests.update"];
for(const permission of operational)test(`상담사 업무 허용: ${permission}`,()=>assert.equal(hasPermission("agent",permission),true));
const privileged:Permission[]=["customer.update","customer.create","support.reassign","bot.read","bot.configure","bot.create","bot.delete","bot.move","knowledge.manage","bot.test","installation.read","members.agent","members.admin","analytics.read","partner.secrets","partner.billing"];
for(const permission of privileged)test(`상담사 관리 권한 거부: ${permission}`,()=>assert.equal(hasPermission("agent",permission),false));
for(const permission of ["partner.secrets","partner.billing","bot.create","bot.delete","bot.move","members.admin","customer.create"] as Permission[])test(`고객사 관리자 제한: ${permission}`,()=>assert.equal(hasPermission("admin",permission),false));
test("플랫폼 마스터·알 수 없는 역할은 고객사 권한을 갖지 않는다",()=>{
  for(const role of ["master","is_admin","constructor","__proto__",null,undefined])assert.equal(hasPermission(role,"support.read"),false);
});
test("소유자는 고객사 운영과 파트너 비밀값 관리 가능",()=>{
  for(const permission of [...operational,...privileged])assert.equal(hasPermission("owner",permission),true);
});
test("고객사 관리자는 다른 상담사만 관리하고 자신/관리자/승격을 처리하지 못한다",()=>{
  const actor={userId:"a",role:"admin" as const};
  assert.equal(canManageCustomerMember(actor,{userId:"b",role:"agent"},null),true);
  assert.equal(canManageCustomerMember(actor,{userId:"b",role:"agent"},"admin"),false);
  assert.equal(canManageCustomerMember(actor,{userId:"b",role:"admin"},null),false);
  assert.equal(canManageCustomerMember(actor,{userId:"a",role:"agent"},null),false);
  assert.equal(canManageCustomerMember({userId:"a",role:"agent"},{userId:"b",role:"agent"},null),false);
});
const legacy=(id:string,email:string|null)=>({id,email,name:"이관 테스트",password_hash:null,oauth_provider:null,oauth_sub:null,is_admin:false});
test("대소문자/공백 이메일 충돌은 자동 병합하지 않고 이관을 차단",()=>{
  assert.deepEqual(inspectLegacyIdentities([legacy("a","QA@example.com"),legacy("b"," qa@example.com ")]),[{code:"normalized_email_conflicts",count:1}]);
});
test("OAuth subject 충돌과 불완전 연결을 탐지",()=>{
  assert.deepEqual(inspectLegacyIdentities([
    {...legacy("a",null),oauth_provider:"google",oauth_sub:"123"},
    {...legacy("b",null),oauth_provider:"google",oauth_sub:"123"},
    {...legacy("c",null),oauth_provider:"google"},
  ]),[{code:"oauth_subject_conflicts",count:1},{code:"incomplete_oauth_links",count:1}]);
});
test("이메일 없는 기존 개발 계정은 임의 이메일 생성 없이 이관 가능",()=>assert.deepEqual(inspectLegacyIdentities([legacy("a",null),legacy("b","")]),[]));
