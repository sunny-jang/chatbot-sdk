/**
 * 로컬 QA 전용. 앱 DB와 같은 Docker PostgreSQL에 "고객사 DB" 역할의 customer_sample 데이터베이스,
 * 읽기 전용 사용자 sample_reader, 메뉴 표를 만든다. 접속 정보는 /tmp의 비공개 파일에만 쓴다.
 */
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const FIXTURE = "/tmp/chatbot-qa-runtime/db-fixture.json";
const DATABASE = "customer_sample",
  USER = "sample_reader";

async function main() {
  const u = new URL(process.env.POSTGRES_URL || "");
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || u.pathname != "/chatbot_qa")
    throw Error("전용 로컬 QA DB만 허용");
  const password = randomUUID();
  const admin = postgres(process.env.POSTGRES_URL!, { ssl: "require", prepare: false, max: 1 });
  try {
    const [db] = await admin`SELECT 1 FROM pg_database WHERE datname=${DATABASE}`;
    if (!db) await admin.unsafe(`CREATE DATABASE ${DATABASE}`);
    const [role] = await admin`SELECT 1 FROM pg_roles WHERE rolname=${USER}`;
    // 비밀번호는 식별자가 아니므로 리터럴로 인용한다(작은따옴표 없는 UUID).
    await admin.unsafe(`${role ? "ALTER" : "CREATE"} ROLE ${USER} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.unsafe(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${USER}`);
  } finally {
    await admin.end();
  }
  const sampleUrl = new URL(process.env.POSTGRES_URL!);
  sampleUrl.pathname = "/" + DATABASE;
  const sample = postgres(sampleUrl.toString(), { ssl: "require", prepare: false, max: 1 });
  try {
    await sample`CREATE TABLE IF NOT EXISTS menu (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL,
      description TEXT, is_active INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;
    await sample`TRUNCATE menu`;
    await sample`INSERT INTO menu(id,name,category,price,description,is_active,updated_at) VALUES
      (1,'아메리카노','커피',4500,'에스프레소 샷에 뜨거운 물을 더한 기본 커피. 아이스 선택 가능.',1,'2026-10-01 09:00'),
      (2,'카페라떼','커피',5000,'에스프레소에 스팀 우유를 더한 부드러운 라떼. 오트밀크 변경 +500원.',1,'2026-10-01 09:00'),
      (3,'바닐라라떼','커피',5500,'바닐라 시럽을 더한 라떼.',1,'2026-10-01 09:00'),
      (4,'콜드브루','커피',5000,'12시간 저온 추출. 아이스 전용.',1,'2026-10-01 09:00'),
      (5,'자몽에이드','에이드',6000,'생자몽 과육이 들어간 탄산 음료.',1,'2026-10-01 09:00'),
      (6,'레몬에이드','에이드',5500,'수제 레몬청 탄산 음료.',1,'2026-10-01 09:00'),
      (7,'얼그레이 밀크티','티',5800,'얼그레이 찻잎을 우린 밀크티. 따뜻하게만 제공.',1,'2026-10-01 09:00'),
      (8,'캐모마일','티',5000,'카페인 없는 허브티.',1,'2026-10-01 09:00'),
      (9,'치즈케이크','디저트',6500,'뉴욕 스타일 치즈케이크 한 조각.',1,'2026-10-01 09:00'),
      (10,'크루아상','디저트',4000,'매일 아침 구운 버터 크루아상.',1,'2026-10-01 09:00'),
      (11,'초코 브라우니','디저트',4500,'진한 다크초콜릿 브라우니.',0,'2026-10-01 09:00'),
      (12,'스콘','디저트',3800,'플레인 스콘. 클로티드 크림 포함.',1,'2026-10-01 09:00'),
      (13,'원두 선물세트 소','선물세트',15000,'싱글 오리진 원두 200g 1봉 + 드립백 5개.',1,'2026-10-01 09:00'),
      (14,'드립백 선물세트','선물세트',18000,'드립백 12개 구성. 선물 포장 포함.',1,'2026-10-01 09:00'),
      (15,'원두 선물세트 중','선물세트',25000,'원두 200g 2봉 + 머그컵.',1,'2026-10-01 09:00'),
      (16,'프리미엄 선물세트','선물세트',35000,'게이샤 원두 100g + 드립 세트.',1,'2026-10-01 09:00')`;
    await sample`CREATE TABLE IF NOT EXISTS menu_big (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)`;
    await sample`TRUNCATE menu_big`;
    await sample`INSERT INTO menu_big(id,name,price) SELECT g, '샘플 메뉴 ' || g, 1000 + (g % 50) * 100 FROM generate_series(1,5200) g`;
    await sample`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT, grade TEXT, joined_at DATE
    )`;
    await sample`TRUNCATE members`;
    await sample`INSERT INTO members VALUES (1,'홍길동','010-0000-0001','hong@example.test','서울시 어딘가','VIP','2026-01-05'),(2,'김영희','010-0000-0002','kim@example.test','부산시 어딘가','일반','2026-03-10')`;
    // 실시간 조회(PRD-db-live-lookup)용 재고 표. 메뉴 표는 DB 지식 검사가 쓰므로 건드리지 않는다.
    await sample`CREATE TABLE IF NOT EXISTS menu_stock (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, size TEXT NOT NULL, category TEXT NOT NULL, stock INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    )`;
    await sample`TRUNCATE menu_stock`;
    await sample`INSERT INTO menu_stock(id,name,size,category,stock,is_active) VALUES
      (1,'아메리카노','R','커피',12,1),(2,'아메리카노','L','커피',7,1),
      (3,'카페라떼','R','커피',5,1),(4,'카페라떼','L','커피',0,1),
      (5,'바닐라라떼','R','커피',3,1),(6,'콜드브루','R','커피',9,1),
      (7,'자몽에이드','R','에이드',4,1),(8,'치즈케이크','R','디저트',2,1),
      (9,'초코 브라우니','R','디저트',0,0)`;
    // 실행 제한(G7) 검사용: 행마다 1초 쉬는 뷰.
    await sample.unsafe(`CREATE OR REPLACE FUNCTION slow_text(t text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN t; END $$`);
    await sample.unsafe(`CREATE OR REPLACE VIEW slow_stock AS SELECT id, slow_text(name) AS name, size, stock FROM menu_stock`);
    await sample`ANALYZE menu_stock`;
    await sample`ANALYZE menu`;
    await sample`ANALYZE menu_big`;
    await sample`ANALYZE members`;
    await sample.unsafe(`GRANT USAGE ON SCHEMA public TO ${USER}`);
    await sample.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${USER}`);
    await sample.unsafe(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${USER}`);
  } finally {
    await sample.end();
  }
  await writeFile(
    FIXTURE,
    JSON.stringify({
      kind: "postgres",
      host: u.hostname === "localhost" ? "127.0.0.1" : u.hostname,
      port: Number(u.port || 5432),
      database: DATABASE,
      username: USER,
      password,
      ssl: true,
      adminUrl: sampleUrl.toString(),
    }),
    { mode: 0o600 },
  );
  console.log("QA 고객사 샘플 DB(customer_sample)·읽기 전용 사용자·메뉴 표 준비 완료. 접속 정보는 /tmp의 비공개 파일에 보관.");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
