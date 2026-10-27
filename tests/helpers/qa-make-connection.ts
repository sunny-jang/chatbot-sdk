/** QA 화면 점검용: 데스크 관리자로 "달빛 카페 메뉴 DB" 연결을 만든다(이미 있으면 그대로). 비밀값은 출력하지 않는다. */
import { readFile } from "node:fs/promises";
import { api, login, desk } from "./portal-http";
async function main() {
  const f = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/portal-fixture.json", "utf8"));
  const db = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/db-fixture.json", "utf8"));
  const admin = await login(f.admin, desk);
  const base = "/api/customer/qa-cafe/data-connections";
  const list = await api(base, desk, admin);
  const existing = (list.data as { id: string; name: string }[]).find((c) => c.name === "달빛 카페 메뉴 DB");
  if (existing) return console.log("connection exists", existing.id);
  const r = await api(base, desk, admin, "POST", { action: "create", name: "달빛 카페 메뉴 DB", kind: db.kind, host: db.host, port: db.port, database: db.database, username: db.username, password: db.password, ssl: db.ssl });
  console.log("create", r.status, r.data.id);
  const t = await api(`${base}/${r.data.id}`, desk, admin, "POST", { action: "test" });
  console.log("test", t.status, t.data.result?.ok, t.data.result?.tableCount);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
