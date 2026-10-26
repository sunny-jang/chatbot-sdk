import type { Metadata } from "next";
import { egressIpLabel } from "@/lib/data-connections/host";
import PrintButton from "./PrintButton";
import "./sheet.css";

export const metadata: Metadata = {
  title: "데이터베이스 연결 요청서",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** 고객사가 호스팅 업체·개발사에 보내는 한 장짜리 요청서. 로그인 없이 열리고 고객 데이터는 담지 않는다. */
export default async function ConnectionRequestSheet({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; for?: string }>;
}) {
  const p = await searchParams;
  const kind = p.kind === "mysql" ? "mysql" : "postgres";
  const forName = (p.for ?? "").replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 80);
  const ip = egressIpLabel();
  const ipNote = ip === "배포 후 안내" ? "우리 서버 IP는 담당자가 별도로 안내해 드립니다." : `우리 서버 IP: ${ip}`;
  return (
    <main className="sheet">
      <header className="sheet-head">
        <div>
          <p className="sheet-kicker">Ideal AI 챗봇 · 데이터베이스 연결 요청서</p>
          <h1>{forName ? `${forName} ` : ""}챗봇 지식용 읽기 전용 DB 접속 요청</h1>
          <p className="sheet-lead">
            챗봇이 {kind === "mysql" ? "MySQL(MariaDB)" : "PostgreSQL"} 데이터베이스의 일부 테이블을 <strong>읽기만</strong> 해서
            고객 질문에 답하려고 합니다. 아래 항목대로 읽기 전용 계정을 만들어 주시고 회신 항목을 알려주세요.
          </p>
        </div>
        <PrintButton />
      </header>

      <section>
        <h2>1. 요청 내용</h2>
        <ul>
          <li>지정한 테이블(또는 뷰)만 SELECT 할 수 있는 <strong>읽기 전용 계정</strong> 1개</li>
          <li>우리 서버에서 DB 포트로 접속할 수 있도록 <strong>방화벽 허용</strong> ({ipNote})</li>
          <li>SSL 접속 가능 여부(가능하면 SSL 사용)</li>
          <li>쓰기·삭제·스키마 변경 권한은 필요하지 않으며, 부여하지 않아 주세요</li>
        </ul>
      </section>

      <section>
        <h2>2. 우리가 하는 것 · 하지 않는 것</h2>
        <div className="sheet-cols">
          <div>
            <h3>합니다</h3>
            <ul>
              <li>읽기 전용 트랜잭션에서 SELECT만 실행</li>
              <li>조회 1건당 20초 제한, 동시 연결 최대 2개, 500행씩 나눠 읽기</li>
              <li>접속 정보는 암호화 저장, 비밀번호는 화면에 다시 표시하지 않음</li>
              <li>공개 주소(도메인·공인 IP)로만 접속, 사설망 접속 없음</li>
            </ul>
          </div>
          <div>
            <h3>하지 않습니다</h3>
            <ul>
              <li>데이터 수정·삭제·테이블 생성</li>
              <li>개인정보 추정 컬럼(이름·전화·이메일·주소 등) 자동 가져오기</li>
              <li>접속 정보를 로그·오류 메시지에 기록</li>
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2>3. 읽기 전용 계정 만드는 예시</h2>
        <p className="sheet-note">
          DB 관리자가 실행하는 예시입니다. 계정 이름·비밀번호·테이블 이름은 환경에 맞게 바꿔주세요.
        </p>
        <h3>PostgreSQL</h3>
        <pre>{`CREATE ROLE chatbot_reader LOGIN PASSWORD '<강한 비밀번호>';
GRANT CONNECT ON DATABASE <db이름> TO chatbot_reader;
GRANT USAGE ON SCHEMA public TO chatbot_reader;
GRANT SELECT ON TABLE <테이블1>, <테이블2> TO chatbot_reader;
-- 모든 테이블을 허용하려면: GRANT SELECT ON ALL TABLES IN SCHEMA public TO chatbot_reader;`}</pre>
        <h3>MySQL · MariaDB</h3>
        <pre>{`CREATE USER 'chatbot_reader'@'%' IDENTIFIED BY '<강한 비밀번호>';
GRANT SELECT ON <db이름>.<테이블1> TO 'chatbot_reader'@'%';
GRANT SELECT ON <db이름>.<테이블2> TO 'chatbot_reader'@'%';
FLUSH PRIVILEGES;
-- '%' 대신 우리 서버 IP로 제한할 수 있습니다.`}</pre>
      </section>

      <section>
        <h2>4. 회신해 주실 항목</h2>
        <table className="sheet-table">
          <tbody>
            <tr>
              <th>DB 종류·버전</th>
              <td>예: PostgreSQL 15 / MySQL 8.0 / MariaDB 10.6</td>
            </tr>
            <tr>
              <th>호스트</th>
              <td>도메인 또는 공인 IP (사설 IP·localhost는 연결되지 않습니다)</td>
            </tr>
            <tr>
              <th>포트</th>
              <td>예: 5432 / 3306 (1024 이상)</td>
            </tr>
            <tr>
              <th>데이터베이스 이름</th>
              <td></td>
            </tr>
            <tr>
              <th>사용자 이름</th>
              <td>읽기 전용 계정</td>
            </tr>
            <tr>
              <th>비밀번호</th>
              <td>이 문서가 아닌 별도 안전한 경로로 전달해 주세요</td>
            </tr>
            <tr>
              <th>SSL</th>
              <td>필수 / 가능 / 불가</td>
            </tr>
            <tr>
              <th>허용한 테이블</th>
              <td>테이블(뷰) 이름 목록</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer className="sheet-foot">
        받은 값은 챗봇 관리 화면의 고객사 설정 → 데이터 연결에 입력하고 ‘연결 테스트’로 확인합니다. 문의: 담당 에이전시
      </footer>
    </main>
  );
}
