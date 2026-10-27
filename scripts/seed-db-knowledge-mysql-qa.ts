/**
 * 로컬 QA 전용. Docker MySQL(chatbot-qa-mysql, 127.0.0.1:55437)에 "고객사 DB" 역할의 customer_sample,
 * 읽기 전용 사용자 sample_reader, 메뉴 표를 만든다. 관리자 접속은 /tmp/chatbot-qa-runtime/mysql-admin.json,
 * 읽기 전용 접속 정보는 /tmp/chatbot-qa-runtime/mysql-fixture.json 에만 쓴다.
 */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

async function main() {
  const admin = JSON.parse(await readFile("/tmp/chatbot-qa-runtime/mysql-admin.json", "utf8"));
  if (!["127.0.0.1", "localhost"].includes(admin.host)) throw Error("로컬 QA MySQL만 허용");
  const password = randomUUID();
  const conn = await mysql.createConnection({ host: admin.host, port: admin.port, user: admin.user, password: admin.password, multipleStatements: true });
  try {
    await conn.query("CREATE DATABASE IF NOT EXISTS customer_sample CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await conn.query("CREATE USER IF NOT EXISTS 'sample_reader'@'%' IDENTIFIED BY ?", [password]);
    await conn.query("ALTER USER 'sample_reader'@'%' IDENTIFIED BY ?", [password]);
    await conn.query("GRANT SELECT ON customer_sample.* TO 'sample_reader'@'%'");
    await conn.query("FLUSH PRIVILEGES");
    await conn.query("USE customer_sample");
    await conn.query(`CREATE TABLE IF NOT EXISTS menu (
      id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, category VARCHAR(50) NOT NULL, price DECIMAL(10,0) NOT NULL,
      description TEXT, is_active TINYINT NOT NULL DEFAULT 1, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    await conn.query("TRUNCATE menu");
    await conn.query(`INSERT INTO menu(id,name,category,price,description,is_active,updated_at) VALUES
      (1,'아메리카노','커피',4500,'에스프레소에 뜨거운 물을 더한 기본 커피.',1,'2026-10-01 09:00:00'),
      (2,'카페라떼','커피',5000,'스팀 우유를 더한 라떼.',1,'2026-10-01 09:00:00'),
      (3,'초코 브라우니','디저트',4500,'다크초콜릿 브라우니.',0,'2026-10-01 09:00:00'),
      (4,'원두 선물세트 소','선물세트',15000,'원두 200g 1봉 + 드립백 5개.',1,'2026-10-01 09:00:00'),
      (5,'프리미엄 선물세트','선물세트',35000,'게이샤 원두 100g + 드립 세트.',1,'2026-10-01 09:00:00')`);
  } finally {
    await conn.end();
  }
  await writeFile(
    "/tmp/chatbot-qa-runtime/mysql-fixture.json",
    JSON.stringify({ kind: "mysql", host: admin.host, port: admin.port, database: "customer_sample", username: "sample_reader", password, ssl: false }),
    { mode: 0o600 },
  );
  console.log("QA MySQL 고객사 샘플 DB(customer_sample)·읽기 전용 사용자·메뉴 표 준비 완료. 접속 정보는 /tmp의 비공개 파일에 보관.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
