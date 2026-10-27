# DB 지식 연동 테스트 시나리오 (PRD-db-knowledge-source)

대상: 통합 브랜치 `codex/db-knowledge` (단계 A~E PR 머지 후). 이 문서는 [PRD](../PRD-db-knowledge-source.md) §9 인수 테스트 C1~C12와 §8 구현 순서 A~E의 단계별 시나리오를 한 곳에 모은 목록이다. 코드 작업 전에 작성해 각 단계 PR이 어떤 검사를 통과해야 하는지 먼저 정하고, 단계가 머지될 때마다 §8 실행 기록을 갱신한다.

표기: **자동** = 단위(`tests/*.test.ts`)·DB(`tests/db-knowledge.integration.ts`, 전체 롤백)·HTTP(`tests/db-knowledge-http.integration.ts`) 스위트의 검사명으로 통과 확인 · **수동** = QA 서버(3013) 브라우저 절차(캡처는 `docs/verification/db-knowledge/`) · **미검증(환경)** = 실제 OpenAI 키·고정 IP·운영 DB 등 운영 설정이 있어야 확인 가능 · **범위 외** = 이번 통합에 미포함.

## 0. 실행 방법

```sh
# 격리 QA 환경. 운영 DB(.env.local)는 절대 쓰지 않는다.
ENV=/tmp/chatbot-qa-runtime/app-3013.env           # app.env를 복사해 포트만 3013으로 바꾼 파일
node --env-file=$ENV --import tsx scripts/migrate-customer-access.ts --apply
node --env-file=$ENV --import tsx scripts/seed-customer-portal-qa.ts        # 계정 fixture (portal-fixture.json)
node --env-file=$ENV --import tsx scripts/seed-db-knowledge-qa.ts           # "고객사 DB" 역할의 샘플 DB·읽기 전용 사용자·메뉴 표 (db-fixture.json)
node --import tsx --test tests/*.test.ts
PORTAL_DB_CHECK=1 node --env-file=$ENV --import tsx tests/db-knowledge.integration.ts
PORTAL_HTTP_BASE=http://localhost:3013 node --env-file=$ENV --import tsx tests/db-knowledge-http.integration.ts
```

진입점(QA): 에이전시 `http://localhost:3013`, 고객사 데스크 `http://desk.localhost:3013`, 마스터 `http://master.localhost:3013`. 계정은 `/tmp/chatbot-qa-runtime/portal-fixture.json`(owner/admin/agent/other). "고객사 DB" 접속 정보는 `/tmp/chatbot-qa-runtime/db-fixture.json`(읽기 전용 사용자, 비밀번호는 시드마다 바뀜). **접속 정보·비밀번호는 이 문서·PR·채팅에 적지 않는다.**

### 0.1 QA용 "고객사 DB"

로컬 Docker PostgreSQL(`chatbot_qa` 컨테이너)을 고객사 DB로 삼는다. 시드가 만드는 것:

| 항목 | 내용 |
| --- | --- |
| 데이터베이스 | `customer_sample` (앱 DB `chatbot_qa`와 분리) |
| 사용자 | `sample_reader` — `customer_sample`에 CONNECT + 모든 테이블 SELECT만. 쓰기 권한 없음 |
| `menu` 표 | id, name, category, price(원), description, is_active(1/0), updated_at. 카페 메뉴 12행 + 선물세트 4행(가격 15,000~35,000) |
| `menu_big` 표 | generate_series 5,200행 (C5 상한 초과용) |
| `members` 표 | name, phone, email, address 컬럼 — 개인정보 추정 컬럼 기본 제외 확인용 |
| `menu_mysql` | (E단계) 별도 MySQL 컨테이너(`chatbot-qa-mysql`, 127.0.0.1:55437)에 같은 메뉴 표 |

QA 서버는 로컬 주소를 고객사 DB로 쓰므로 `DATA_CONNECTION_ALLOW_HOSTS=127.0.0.1`을 env에 둔다. 이 변수는 **정확히 일치하는 호스트만** 공개 주소 검사에서 예외로 두므로 C1(사설 IP 거부)은 `10.0.0.1`·`192.168.1.1`로 그대로 검증한다. 운영 env에는 이 변수를 두지 않는다.

QA 서버에는 OpenAI 키가 없다. 가져오기·답변 미리보기를 끝까지 돌리기 위해 **로컬 DB에서만 동작하는 결정적 임베딩 대체**(`EMBEDDINGS_FAKE=1`, POSTGRES_URL이 localhost일 때만 유효)를 둔다. 실제 임베딩 품질(C10·C11의 답 정확도)은 미검증(환경)으로 남기고 운영 키로 1회 확인한다.

## 1. PRD 인수 테스트 C1~C12 매핑

| 번호 | 시나리오 | 기대 | 단계 | 검증 수단 |
| --- | --- | --- | --- | --- |
| C1 | 사설 IP 호스트로 연결 | 거부, 사유 표시 | A | 단위 `connectionHost rejects private/loopback/link-local`, HTTP `A-05 사설 IP·localhost 호스트 거부` · 수동 A-M3 |
| C2 | 틀린 비밀번호 | "비밀번호가 틀렸어요", 접속 정보 로그 없음 | A | HTTP `A-06 틀린 비밀번호는 사람 말 사유·응답에 비밀번호 미포함`, DB `A-D4 last_error에 비밀번호·접속 문자열 미포함` · 수동 A-M4 |
| C3 | 연결 저장 후 다시 열기 | 비밀번호 비표시, 나머지 표시 | A | HTTP `A-08 목록·상세 응답에 secret 필드 없음(has_secret만)` · 수동 A-M5 |
| C4 | 테이블 선택 → AI 역할 제안 → 미리보기 3문서 | 제목·본문·제외가 제안되고 문서가 "라벨: 값" 형식 | B | 단위 `draftColumnRoles`·`renderRowDocument`, HTTP `B-03 초안`·`B-05 미리보기` · 수동 B-M2 |
| C5 | 5,000행 넘는 테이블 가져오기 | 상한까지 반영 + 초과 안내 | B | HTTP `B-08 row_limit 초과분 제외·안내` (QA에선 row_limit=50으로 축소 검증 + menu_big 5,200행 1회) · 수동 B-M5 |
| C6 | 행 값 변경 후 동기화 | 해당 문서만 갱신, 임베딩 재계산 1건 | C | DB `C-D2 변경 1행만 갱신·임베딩 1회`, HTTP `C-03 지금 동기화 결과 updated=1` |
| C7 | 행 삭제 후 동기화 | 문서 보관(검색 제외), 삭제 옵션이면 삭제 | C | DB `C-D3 사라진 행 보관`·`C-D4 삭제 옵션` · 수동 C-M2 |
| C8 | 다른 고객사 관리자가 연결 ID로 접근 | 404 | A | HTTP `A-09 다른 고객사·담당자·비로그인 404/401/403`, DB `A-D5 범위 밖 연결 조회 null` |
| C9 | 연속 3회 동기화 실패 | 자동 동기화 중지 + 소스에 안내 | C | DB `C-D6 3회 실패 후 enabled=false·안내문`, HTTP `C-05 실패 소스 목록 상태` · 수동 C-M3 |
| C10 | 챗봇에 "아메리카노 얼마예요?" | 해당 행 근거로 답, 출처에 테이블·행 제목 | D | HTTP `D-02 출처 보기에 연결 이름·테이블·행 제목` · 수동 D-M1 · 답 정확도 미검증(환경) |
| C11 | "2만원 이하 선물세트" | 숫자 필드 필터 후 답 | D | 단위 `parseNumericIntent`·`filterNumericFields`, HTTP `D-03 숫자 조건 질문은 필터 통과 행만 후보` · 수동 D-M2 |
| C12 | 연결 삭제 | 접속 정보 파기, 소스 비활성, 문서는 보관 | A(삭제·파기) / C(소스 비활성·문서 보관) | HTTP `A-10 삭제 후 secret_enc NULL·목록 제외`, DB `C-D7 연결 삭제 시 소스 비활성·문서 보관` · 수동 A-M6 |

## 2. 단계 A — 연결(data_connections)·Postgres 커넥터·연결 UI·요청서

### 2.1 시나리오

| ID | 역할 / 호스트 | 절차 | 기대 결과 | 자동/수동 |
| --- | --- | --- | --- | --- |
| A-01 | 고객사 관리자 / desk | 고객사 설정 → 데이터 연결 → 연결 추가(Postgres, QA 샘플 DB) → 연결 테스트 | "연결됐어요 · 테이블 N개" 와 테이블 목록(이름·행 수 추정) | 자동(HTTP `A-01`)+수동 A-M1 |
| A-02 | 고객사 관리자 / desk | 테스트 성공 후 저장 | 목록에 이름·종류·호스트·DB·사용자·상태 "정상"·마지막 테스트 시각. 감사 `data_connection.create` | 자동(HTTP `A-02`, DB `A-D1`) |
| A-03 | 에이전시 소유자 / 에이전시 | `/customers/{id}` 데이터 연결 섹션에서 같은 흐름 | desk와 동일 동작·동일 컴포넌트 | 자동(HTTP `A-03`)+수동 A-M2 |
| A-04 | 고객사 관리자 | 포트 80·0·70000 입력 | "포트는 1024~65535" 거부 | 자동(단위 `connectionPort`, HTTP `A-04`) |
| A-05 | 고객사 관리자 | 호스트 `10.0.0.1`, `192.168.1.1`, `localhost`, `169.254.169.254`, 사설 IP로 풀리는 도메인 | "내부 주소는 연결할 수 없어요" (C1). 허용 목록(`DATA_CONNECTION_ALLOW_HOSTS`)에 없는 로컬 주소도 거부 | 자동(단위·HTTP `A-05`) |
| A-06 | 고객사 관리자 | 올바른 호스트, 틀린 비밀번호로 테스트 | "비밀번호가 틀렸어요…" (C2). 응답·`last_error`·서버 로그에 비밀번호·접속 문자열 없음 | 자동(HTTP `A-06`, DB `A-D4`) |
| A-07 | 고객사 관리자 | 없는 DB 이름 / 닫힌 포트 / 존재하지 않는 호스트 | 각각 "데이터베이스 이름을 찾지 못했어요" / "서버가 연결을 거부했어요… 방화벽에서 우리 IP 허용" / "호스트 주소를 찾지 못했어요" | 자동(HTTP `A-07`) |
| A-08 | 고객사 관리자 | 저장된 연결 다시 열기(GET 목록·상세) | 비밀번호 필드 비어 있음, `has_secret: true`만. 호스트·포트·DB·사용자·SSL 표시 (C3) | 자동(HTTP `A-08`)+수동 A-M5 |
| A-09 | 다른 고객사 관리자(other) / 담당자(agent) / 비로그인 | 연결 ID로 GET·PATCH·DELETE·테스트 | other 404, agent(knowledge.manage 없음) 404, 비로그인 401. 에이전시 호스트에서 다른 에이전시 소유자도 404 (C8) | 자동(HTTP `A-09`, DB `A-D5`) |
| A-10 | 고객사 관리자(settings.manage=admin 이상) | 연결 삭제 | 확인 후 `secret_enc` NULL·status `deleted`·목록 제외, 감사 `data_connection.delete` (C12 앞부분) | 자동(HTTP `A-10`, DB `A-D2`)+수동 A-M6 |
| A-11 | 고객사 관리자 | 비밀번호 없이 호스트만 수정(PATCH) → 테스트 | 기존 비밀번호 유지·새 호스트로 테스트. 비밀번호를 넣으면 교체 | 자동(HTTP `A-11`, DB `A-D3`) |
| A-12 | 고객사 관리자 | 연결 4개째 추가 | "고객사당 연결은 3개까지" 거부 | 자동(HTTP `A-12`) |
| A-13 | 누구나 | 연결 요청서 공유 페이지 `/db-connection-request?kind=postgres` | 필요 권한·우리 서버 IP(`DATA_CONNECTION_EGRESS_IPS`, 없으면 "배포 후 안내")·읽기 전용 계정 SQL 예시(Postgres/MySQL)·회신 항목. 로그인 불필요, 고객 데이터 없음 | 자동(HTTP `A-13`)+수동 A-M7 |
| A-14 | 서버 | 커넥터 세션 | 읽기 전용 트랜잭션, `statement_timeout` 20초, 풀 2, 식별자 인용. `INSERT`를 시도하면 read-only 오류 | 자동(DB `A-D6 read-only 세션에서 쓰기 실패`, 단위 `quoteIdentifier`) |
| A-15 | 서버 | 암호화 왕복 | `encrypt→decrypt` 동일 문자열, 다른 키로는 복호화 실패 | 자동(단위 `crypto round trip`) |
| A-16 | 고객사 관리자 | 테스트 중 화면 | 버튼 "테스트 중…"·스피너, 완료 후 성공/실패 문구, 버튼 재활성 | 수동 A-M1 |

### 2.2 자동 테스트 매핑 (A)

- 단위 `tests/data-connections.test.ts`: `connectionHost` 공개/사설 판정(IPv4·IPv6·호스트명 허용 목록), `connectionPort` 범위, `quoteIdentifier`(따옴표 이스케이프·스키마.테이블), `humanizeConnectionError`(pg 코드 28P01/28000/3D000·ECONNREFUSED·ETIMEDOUT·ENOTFOUND·SSL), `crypto` 왕복.
- DB `tests/db-knowledge.integration.ts` A-D1~A-D6: 생성·감사, 삭제 시 secret 파기, PATCH 비밀번호 유지, last_error 비밀값 미포함, 범위 밖 조회 null, read-only 세션 쓰기 실패.
- HTTP `tests/db-knowledge-http.integration.ts` A-01~A-13.

### 2.3 수동 UI 점검 (A)

| ID | 화면 | 확인 | 캡처 |
| --- | --- | --- | --- |
| A-M1 | desk 고객사 설정 → 데이터 연결 | 빈 상태 문구("아직 연결이 없어요…요청서")·추가 폼 정렬·라벨·테스트 중 로딩·성공 결과(테이블 목록) | `a-desk-connection-empty.jpg`, `a-desk-connection-test-ok.jpg` |
| A-M2 | 에이전시 `/customers/{id}` | 같은 섹션이 고객사 정보 아래에 같은 톤으로 | `a-agency-connection.jpg` |
| A-M3 | 사설 IP 입력 | 오류 문구 한 줄 + 할 일 | `a-error-private-host.jpg` |
| A-M4 | 틀린 비밀번호 | "비밀번호가 틀렸어요" 문구, 폼 값 유지 | `a-error-password.jpg` |
| A-M5 | 저장 후 수정 열기 | 비밀번호 칸 placeholder "저장된 비밀번호 유지(바꾸려면 입력)" | `a-edit-keeps-secret.jpg` |
| A-M6 | 삭제 | 확인 대화상자 → 목록에서 제거·안내 | `a-delete.jpg` |
| A-M7 | 요청서 공유 페이지 | 한 장 구성, 인쇄 레이아웃, 모바일 390px | `a-request-sheet.jpg`, `a-request-sheet-mobile.jpg` |
| A-M8 | 모바일 390px | 연결 폼·목록 겹침·잘림 없음 | `a-desk-connection-mobile.jpg` |

## 3. 단계 B — db_sources·컬럼 역할·AI 초안·답변 미리보기·1회 가져오기

| ID | 역할 | 절차 | 기대 결과 | 자동/수동 |
| --- | --- | --- | --- | --- |
| B-01 | 고객사 관리자 / desk 지식 탭 | "DB에서 가져오기" → 연결 선택 → 테이블 목록 | 연결이 없으면 설정으로 안내 링크. 테이블 이름·행 수 추정 표시 | 자동(HTTP `B-01`)+수동 B-M1 |
| B-02 | 고객사 관리자 | `menu` 선택 → 미리보기 | 상위 10행, 컬럼 이름·타입 | 자동(HTTP `B-02`) |
| B-03 | 고객사 관리자 | AI 초안 요청 | 제목=name, 고유키=id, 본문=category·price·description·is_active, 제외=updated_at. 라벨 한국어·단위("원") 초안. OPENAI 키 없으면 규칙 기반 초안으로 폴백하고 응답에 `draftedBy: "rules"` | 자동(단위 `draftColumnRoles`, HTTP `B-03`)+수동 B-M2 |
| B-04 | 고객사 관리자 | `members` 표 선택 → 초안 | name·phone·email·address 기본 제외 + 개인정보 경고. 포함하려면 체크 + 경고 문구 | 자동(단위 `isPersonalDataColumn`, HTTP `B-04`)+수동 B-M3 |
| B-05 | 고객사 관리자 | 값 매핑(is_active 1=판매중, 0=품절)·필터(is_active = 1)·폴더 지정 → 답변 미리보기 | 문서 3개가 "라벨: 값" 줄, 매핑된 값 표시, 필터로 품절 행 제외. 질문 3개(AI 제안 또는 입력)에 답 (C4) | 자동(단위 `renderRowDocument`, HTTP `B-05`)+수동 B-M4 |
| B-06 | 고객사 관리자 | 가져오기 시작 | 진행률 N/M, 결과 "반영 N·건너뜀 M·실패 K". documents에 source_kind='db', db_source_rows에 row_key·hash. 감사 `db_source.create`·`db_source.sync` | 자동(HTTP `B-06`, DB `B-D1`)+수동 B-M5 |
| B-07 | 고객사 관리자 | 같은 테이블로 소스 한 번 더 | "이미 등록된 테이블" 409 | 자동(HTTP `B-07`) |
| B-08 | 고객사 관리자 | row_limit=50으로 `menu_big` 가져오기 | 50행 반영 + "5,150행이 상한을 넘어 제외됐어요…" (C5). 기본 5,000 상한 1회 수동 확인 | 자동(HTTP `B-08`)+수동 B-M5 |
| B-09 | 고객사 관리자 | 소스 11개째 | "고객사당 소스는 10개까지" 거부 | 자동(HTTP `B-09`) |
| B-10 | 고객사 관리자 | 고유키 컬럼 없이 저장 | "고유키 컬럼을 골라주세요" 거부 | 자동(HTTP `B-10`) |
| B-11 | 다른 고객사·담당자 | 소스 ID로 접근 | 404 | 자동(HTTP `B-11`) |
| B-12 | 에이전시 소유자 / `/bots/{id}/docs` | 같은 공용 컴포넌트로 전 과정 | desk와 동일 | 자동(HTTP `B-12`)+수동 B-M6 |
| B-13 | 서버 | 필터 값 바인딩 | 필터 값에 `'; DROP` 류를 넣어도 바인딩 파라미터로만 전달, 컬럼·테이블 이름은 식별자 인용. 허용되지 않은 연산자 거부 | 자동(단위 `buildRowQuery`) |
| B-14 | 고객사 관리자 | 가져온 문서를 문서 목록에서 보기 | 제목이 행 제목, 본문이 "라벨: 값", 출처 배지 "DB" | 수동 B-M7 |

자동 매핑(B): 단위 `tests/db-sources.test.ts`(`draftColumnRoles` 규칙, `isPersonalDataColumn`, `renderRowDocument`, `buildRowQuery`, `rowHash` 결정성, `numericFieldsOf`), DB B-D1~B-D3(가져오기 트랜잭션·source_kind·row 테이블·상한), HTTP B-01~B-12.

수동(B): B-M1 빈 상태·연결 없음 안내 `b-source-empty.jpg` · B-M2·B-M3 초안 화면(역할·라벨·단위·값 매핑)과 개인정보 경고 `b-pii-warning.jpg` · B-M4 답변 미리보기 `b-answer-preview.jpg` · B-M5 가져오기 결과(진행률 막대는 15행이 1~2초에 끝나 결과 화면으로 대체, 상한 초과 안내는 HTTP B-08로 확인) `b-import-result.jpg` · B-M6 에이전시 docs 화면 `b-agency-docs.jpg` · B-M7 문서 목록 DB 배지 `b-doc-list.jpg` · B-M8 모바일 390px `b-source-mobile.jpg`.

## 4. 단계 C — 동기화(cron)·변경분·보관/삭제·실패 중지·소스 상태

| ID | 역할 | 절차 | 기대 결과 | 자동/수동 |
| --- | --- | --- | --- | --- |
| C-01 | 운영(cron) | `GET /api/cron/db-sync` (Bearer CRON_SECRET) | 예정 시각 지난 enabled 소스만 실행, 고객사당 동시 1개, 전체 동시 `DB_SYNC_CONCURRENCY`(기본 2). 비인가 401 | 자동(HTTP `C-01`, DB `C-D1 due 선택`) |
| C-02 | 고객사 관리자 | 소스 목록 | 마지막 동기화 시각·반영/갱신/제외 건수·다음 예정·주기(수동/매시간/매일 새벽/매주) 표시, "지금 동기화" 버튼 | 자동(HTTP `C-02`)+수동 C-M1 |
| C-03 | 고객사 관리자 | 샘플 DB에서 가격 1행 UPDATE → 지금 동기화 | 결과 updated=1, 다른 문서 content 불변, 임베딩 호출 1회 (C6) | 자동(DB `C-D2`, HTTP `C-03`) |
| C-04 | 고객사 관리자 | 샘플 DB에서 1행 DELETE → 동기화 | 기본(보관): 문서 `archived_at` 설정·검색 제외·db_source_rows status archived. 삭제 옵션: 문서 삭제 (C7) | 자동(DB `C-D3`·`C-D4`)+수동 C-M2 |
| C-05 | 고객사 관리자 | 연결 비밀번호를 틀리게 바꾼 뒤 동기화 3회 | 1·2회 실패 사유·시각 표시, 3회째 `enabled=false` + "연속 3회 실패로 자동 동기화를 멈췄어요. 연결을 확인한 뒤 다시 켜주세요" (C9). 다시 켜면 카운터 0 | 자동(DB `C-D6`, HTTP `C-05`)+수동 C-M3 |
| C-06 | 고객사 관리자 | 새 행 INSERT → 동기화 | created=1, 상한 안에서만 | 자동(DB `C-D5`) |
| C-07 | 고객사 관리자 | 연결 삭제 | 소스 enabled=false·상태 "연결 삭제됨", 문서 보관(검색 제외), 재연결 안내 (C12 뒷부분) | 자동(DB `C-D7`, HTTP `C-07`)+수동 C-M4 |
| C-08 | 서버 | 동기화 중 같은 소스 "지금 동기화" 재요청 | "이미 동기화 중" 409, 잠금 시각 10분 지나면 재실행 가능 | 자동(DB `C-D8`) |
| C-09 | 고객사 관리자 | 소스 삭제 | 문서 보관(기본) 또는 삭제 선택, db_source_rows 삭제, 감사 `db_source.delete` | 자동(HTTP `C-09`) |

수동(C): C-M1 소스 목록 상태 행 `c-source-status.jpg` · C-M2 보관된 문서 표시(목록에서 "보관됨" 배지, 검색 제외) `c-archived-doc.jpg` · C-M3 3회 실패 안내·다시 켜기 `c-sync-stopped.jpg` · C-M4 연결 삭제 후 소스 상태 `c-connection-deleted-source.jpg`.

## 5. 단계 D — 하이브리드 검색(numeric_fields)·출처 보기

| ID | 역할 | 절차 | 기대 결과 | 자동/수동 |
| --- | --- | --- | --- | --- |
| D-01 | 서버 | 가져오기 시 숫자·날짜 컬럼 → `documents.numeric_fields` | `{price: 4500, updated_at: 1761436800}` 형태, 문자열 "4,500원"도 숫자로 | 자동(단위 `numericFieldsOf`, DB `D-D1`) |
| D-02 | 방문자 / 위젯 | "아메리카노 얼마예요?" | 메뉴 행 문서가 후보에 들어가고 답변 응답에 `sources: [{kind:"db", connection, table, title}]`. 위젯 "출처 보기"에 "달빛 카페 DB · menu · 아메리카노" (C10). 행 원본 값은 관리자 화면에서만 | 자동(HTTP `D-02`)+수동 D-M1 · 답 정확도 미검증(환경) |
| D-03 | 방문자 | "2만원 이하 선물세트" | 질문에서 `price <= 20000` 추출 → numeric_fields 필터 통과 문서만 임베딩 순위 (C11). 조건 미충족 문서는 후보 제외 | 자동(단위 `parseNumericIntent`, HTTP `D-03`)+수동 D-M2 |
| D-04 | 방문자 | 보관된 행 질문 | 보관 문서는 후보 제외 | 자동(HTTP `D-04`) |
| D-05 | 방문자 | 숫자 조건이 없는 질문 | 필터 없이 기존 검색과 동일 결과(회귀) | 자동(HTTP `D-05`) |
| D-06 | 담당자 / 상담함 | 봇 답변의 출처 | 테이블·행 제목만, 접속 정보·원본 값 없음 | 자동(HTTP `D-06`) |

수동(D): D-M1 위젯 답변 + 출처 보기 `d-widget-source-closed.png`(접힘), `d-widget-source.png`(펼침) · D-M2 숫자 조건 답(답변 생성은 OpenAI 키가 필요해 QA에서는 채팅 API 응답을 흉내 내 위젯 렌더링만 확인, 숫자 필터는 DB D-D2로 확인) · D-M3 상담함 출처 표시는 범위 외(상담 기록에 출처를 저장하지 않음 — 후속).

## 6. 단계 E — MySQL 커넥터·요금제 한도·마스터 집계

| ID | 역할 | 절차 | 기대 결과 | 자동/수동 |
| --- | --- | --- | --- | --- |
| E-01 | 고객사 관리자 | MySQL 연결 추가·테스트·테이블·미리보기·가져오기 | Postgres와 같은 흐름. 세션 READ ONLY, `max_execution_time`, 백틱 식별자 | 자동(HTTP `E-01`, 단위 `quoteIdentifier mysql`)+수동 E-M1 |
| E-02 | 고객사 관리자 | MySQL 틀린 비밀번호·닫힌 포트 | ER_ACCESS_DENIED_ERROR → "비밀번호가 틀렸어요", ECONNREFUSED → 방화벽 안내 | 자동(단위 `humanizeConnectionError mysql`, HTTP `E-02`) |
| E-03 | 무료(starter) 에이전시 | 연결 추가 | "무료 요금제에서는 DB 연동을 쓸 수 없어요" 403 (기본안) | 자동(단위 `getDbRowLimit`, HTTP `E-03`) |
| E-04 | 그로스 에이전시 | 고객사 합산 DB 행이 10,000 초과하는 가져오기 | 한도까지만 반영 + "요금제 한도(10,000행)" 안내. 프로 50,000, 엔터프라이즈 `enterprise_db_row_limit` | 자동(단위 `getDbRowLimit`, HTTP `E-04`) |
| E-05 | 마스터 / master | `/admin` 에이전시별 연결 수·소스 수·동기화 건수·실패율 | 집계만, 접속 정보·문서 본문 없음 | 자동(HTTP `E-05`)+수동 E-M2 |
| E-06 | 에이전시 소유자 | `/plan` 요금제 비교표 | "DB 지식 행 수" 항목 표시 | 수동 E-M3 |

수동(E): E-M1 MySQL 연결 화면 `e-mysql-connection.jpg` · E-M2 마스터 집계 `e-master-db.jpg` · E-M3 요금제 표 `e-plan-db-rows.jpg`.

## 7. 환경 체크리스트 (운영 반영 전, 코드와 별개)

1. `ENCRYPTION_KEY`가 운영에 설정돼 있는지(기본값이면 접속 정보 암호화가 무의미). 키 교체 시 기존 `secret_enc` 재암호화 절차 필요.
2. `DATA_CONNECTION_EGRESS_IPS`: 우리 서버의 고정 아웃바운드 IP(요청서·방화벽 안내 문구에 표시). 없으면 요청서에 "배포 후 안내"로 표시됨.
3. `DATA_CONNECTION_ALLOW_HOSTS`는 운영에 두지 않는다(QA 전용). `EMBEDDINGS_FAKE`도 운영 금지(로컬 DB에서만 동작하지만 env에서 제거).
4. `CRON_SECRET`와 스케줄러(Vercel cron 등)에 `/api/cron/db-sync` 등록: 매시간 1회(소스 주기는 서버가 판단). `DB_SYNC_CONCURRENCY` 기본 2.
5. 실제 OpenAI 키로 가져오기 1회·답변 미리보기·C10·C11 답 정확도 확인(모요 후보 테이블 1개, 질문 20개 중 18개).
6. 운영 DB 스키마: `data_connections`·`db_sources`·`db_source_rows` 생성과 `documents.source_kind`·`numeric_fields`·`archived_at` 추가는 `initSchema`가 수행(ADD COLUMN IF NOT EXISTS). 배포 전 운영 DB 백업.
7. MySQL 의존성(`mysql2`) 설치와 Vercel 함수 번들 크기 확인.
8. 배포 후 스모크: 요청서 페이지 열림, 연결 테스트 1회(공개 호스트), cron 1회 수동 호출.

## 8. 실행 기록

(아래에 단계별 실행 날짜·커밋·결과를 추가한다. 자동 스위트 수치와 수동 항목별 통과/실패/미검증을 적는다.)

### 2026-10-26 — 시나리오 문서 작성 (코드 전)

실행 없음. 단계 A PR부터 기록한다.

### 2026-10-26 — 단계 A 실행 (PR #22 `feat/db-knowledge-a-connections`, 리뷰 반영 커밋 `2d495a3`)

자동: 단위 159/159(`tests/data-connections.test.ts` 10건 포함) · DB `db-knowledge.integration.ts` 9건(전부 롤백) · HTTP `db-knowledge-http.integration.ts` 13/13 (3013 QA 서버) · `tsc`·`eslint` 통과 · 프로덕션 빌드 통과.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| C1 사설 IP 거부 | 통과 | 단위 `connectionHost rejects…`, HTTP A-05, 수동 `a-error-private-host.jpg` |
| C2 틀린 비밀번호 | 통과 | HTTP A-06, DB A-D4, 수동 `a-error-password.jpg` |
| C3 저장 후 비밀번호 비표시 | 통과 | HTTP A-08, 수동 `a-edit-keeps-secret-test-ok.jpg` |
| C8 다른 고객사 404 | 통과 | HTTP A-09, DB A-D5 |
| C12 앞부분(삭제 → 접속 정보 파기) | 통과 | HTTP A-10, DB A-D2, 수동 `a-delete.jpg` (소스 비활성·문서 보관은 C단계) |
| A-M1 빈 상태·폼·테스트 중·성공 결과 | 통과 | `a-desk-connection-empty.jpg`, `a-desk-connection-form.jpg`, `a-desk-connection-list-tables.jpg` |
| A-M2 에이전시 고객사 화면 | 통과(사이드바 프리페치로 목록 표시가 수 초 늦게 나타나는 기존 환경 특성) | `a-agency-connection.jpg` |
| A-M7 요청서 공유 페이지 | 통과(사이드바 없이 단독 레이아웃, 인쇄 버튼) | `a-request-sheet.jpg`, `a-request-sheet-mobile.jpg` |
| A-M8 모바일 390px | 통과 | `a-desk-connection-mobile.jpg` |
| A-13 요청서 양쪽 호스트 공개 | 통과 | HTTP A-13 |

리뷰(/code-review high) 지적 9건 반영: 필터 비교를 컬럼 타입(kind) 기준으로, 키셋 페이징을 네이티브 키 타입으로, 접속 정보 변경 시 last_tested_at·table_count 초기화, 실패 테스트는 `data_connection.test_failed`로 감사, 단건 GET은 `dataConnection()` 사용, 3개 한도에서 추가 버튼 비활성, HTTP 스위트 정리 범위를 `QA-HTTP ` 접두사로 한정, TLS servername은 ASCII 호스트명에만.

### 2026-10-27 — 단계 B 실행 (`feat/db-knowledge-b-sources`)

자동(리뷰 반영 후): 단위 169/169(`tests/db-sources.test.ts` 10건 포함) · DB `db-knowledge.integration.ts` 17건(B-D0~B-D6, B-09 포함, 전부 롤백) · HTTP `db-knowledge-http.integration.ts` 25/25(B-01~B-08, B-10~B-13) · `tsc`·`eslint` 통과 · 프로덕션 빌드 통과.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| C4 테이블 선택 → 역할 초안 → 미리보기 3문서 "라벨: 값" | 통과 | 단위 `draftColumnRoles`·`renderRowDocument`, HTTP B-03·B-05, 수동 `b-pii-warning.jpg`, `b-answer-preview.jpg` |
| C5 상한 초과 | 통과(QA는 row_limit 50으로 축소: 50행 반영·5,150행 초과 기록) | DB B-D3, HTTP B-08 |
| B-04 개인정보 추정 컬럼 기본 제외·제목 후보에서도 제외 | 통과 | 단위·HTTP B-04, 수동 `b-pii-warning.jpg`(포함으로 바꾸면 경고) |
| B-06 저장하고 가져오기·source_kind·감사 | 통과 | DB B-D1, HTTP B-06, 수동 `b-import-result.jpg` |
| B-07 같은 테이블 중복 409 · B-09 소스 10개 한도 · B-10 고유키 필수 | 통과 | HTTP B-07·B-10, DB B-09 |
| B-11 다른 고객사·담당자 404 · B-12 에이전시 경로 | 통과 | HTTP B-11·B-12 |
| 재가져오기 변경 없음·하트비트와 무관한 보관 기준 | 통과 | DB B-D2 (실행 시작 시각 `sync_started_at` 기준) |
| B-M1/B-M6/B-M7/B-M8 화면 | 통과 | `b-source-empty.jpg`, `b-agency-docs.jpg`, `b-doc-list.jpg`, `b-source-mobile.jpg` |
| 답변 미리보기의 AI 답 | 미검증(환경) — QA에 OpenAI 키 없음. 근거 문서 선택과 "키가 없어 근거 문서만 표시" 안내까지 확인 |

화면 점검 중 고친 것: 고객사 경로에서 봇의 고객사 배정을 못 읽어 "배정되지 않았어요"가 뜨던 문제, 제목·고유키·제외 컬럼에 비활성 입력칸이 보이던 것(역할 설명 문구로 대체), 미리보기 문서가 고정폭 글꼴로 보이던 것, 추천 질문의 "분류이(가)" 같은 어색한 조사와 영문 라벨, 개인정보 컬럼(이름)이 제목으로 잡히던 것.

리뷰(/code-review high) 9건 반영: 가져오기 진행 상태(커서·건수)를 서버 `sync_state`에 두고 클라이언트 값은 무시(상한 우회·시작 없는 단계 차단), 고유키에 중복·빈 값이 있으면 시작 단계에서 거부, 숫자 타입 컬럼만 천 단위 구분(우편번호·코드 앞자리 0 보존), 임베딩 요청을 본문 길이 합 6만 자 단위로 분할, 보관 문서를 먼저 말 걸기(proactive)에서도 제외, 화면에서 누른 가져오기 실패는 연속 실패로 세지 않음(자동 동기화만), 단계마다 소스 하나만 조회, 에이전시 경로에도 같은 출처 검사·분당 120회 제한.

### 2026-10-27 — 단계 C 실행 (`feat/db-knowledge-c-sync`)

자동(리뷰 반영 후): 단위 169/169 · DB `db-knowledge.integration.ts` 25건(C-D1~C-D7, C-D9 포함, 고객사 DB 쪽은 검사 전용 표를 만들어 바꾼 뒤 삭제) · HTTP 29/29(C-01·C-02·C-05·C-07 추가) · `tsc`·`eslint`·빌드 통과.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| C6 값 바뀐 1행만 갱신 | 통과 | DB C-D2(갱신 1·변경 없음 4), 수동 화면 "갱신 1 · 변경 없음 13" |
| C7 사라진 행 보관 / 삭제 옵션 | 통과 | DB C-D3·C-D4, 수동 `c-archived-doc.jpg`(보관됨 · 검색 제외 배지) |
| C9 연속 3회 실패 → 자동 동기화 중지·안내, 다시 켜면 초기화 | 통과 | DB C-D6, HTTP C-05, 수동 `c-sync-stopped.jpg` → 다시 켜기 후 `c-source-status.jpg` |
| C12 뒷부분 연결 삭제 → 소스 중지·문서 보관 | 통과 | DB C-D7, HTTP C-07 |
| C-01 cron 인증·실행 | 통과 | HTTP C-01 (응답에 접속 정보 없음) |
| C-02 주기·마지막·다음 예정·주기 변경 | 통과 | HTTP C-02, 수동 `c-source-status.jpg` |
| C-06 새 행 추가·다시 나타난 행 보관 해제 | 통과 | DB C-D5 |
| C-08 진행 중 재요청 409 | 통과 | DB B-D4 |

설계 메모: "이번 실행에서 못 본 행"은 행마다 실행 식별자(`db_source_rows.run_id`)로 판단한다(같은 초 안에 실행이 이어져도 정확). 자동 동기화는 cron 호출당 45초 안에서 진행하고, 못 끝낸 실행은 다음 호출이 이어 받는다(화면에서 진행 중인 실행은 건드리지 않음). 화면에서 누른 가져오기 실패는 연속 실패로 세지 않는다. Vercel cron은 Hobby 요금제 제약으로 하루 1회(03:00 KST)로 등록했고, 매시간 주기를 쓰려면 Pro 요금제 또는 외부 스케줄러로 `/api/cron/db-sync`를 매시간 호출해야 한다(§7 환경 체크리스트 4).

화면 점검 중 고친 것: 가져오기 후 에이전시 문서 목록(서버 렌더)이 갱신되지 않던 것(router.refresh), 결과 문구에 보관·삭제 건수가 빠져 있던 것.

리뷰(/code-review high) 6건 반영: cron 호출 한 번에 2개만 처리하던 것을 고객사별 대기열을 일꾼(concurrency)이 나눠 시간 예산이 끝날 때까지 차례로 처리하도록, 못 끝낸 cron 실행은 잠금이 만료돼도(다음 날 호출이어도) 처음부터가 아니라 이어서, 이어 받기는 원자적으로 가져가 겹친 호출은 건너뜀, 한 고객사의 밀린 소스가 다른 고객사를 막지 않게, 화면 가져오기와 겹친 경우는 실패가 아니라 건너뜀, 이어 받기 경로 검사(C-D9) 추가.

### 2026-10-27 — 단계 D 실행 (`feat/db-knowledge-d-hybrid`)

자동: 단위 174/174(`tests/db-numeric.test.ts` 5건 추가) · DB 27건(D-D1·D-D2 추가) · HTTP 29/29(회귀) · `tsc`·`eslint`·빌드 통과.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| D-01 숫자 컬럼 → `documents.numeric_fields` | 통과 | DB D-D1, 단위 `numericFieldsOf`(문자 컬럼 "06236"은 제외) |
| C11 "2만원 이하 선물세트" → 숫자 필터 후 임베딩 순위 | 통과(검색 단계) | 단위 `parseNumericIntent`(이하·이상·미만·초과·~·대·만/천), DB D-D2(2만원 넘는 세트 후보 제외) |
| C10 출처 보기(연결 이름 · 테이블 · 행 제목) | 통과(검색·위젯) | DB D-D2(출처에 접속 정보 없음), 위젯 `d-widget-source.png` |
| D-04 보관 문서 제외 · D-05 숫자 조건 없으면 기존과 동일 | 통과 | DB D-D2 |
| C10·C11 실제 답 정확도 | 미검증(환경) — QA에 OpenAI 키 없음. 채팅 API는 키가 있을 때만 검색·답변을 만든다 |
| D-06 상담함 출처 표시 | 범위 외 — 출처는 위젯 응답에만 싣고 상담 기록에는 저장하지 않음(후속 후보) |

설계 메모: 숫자 조건은 단위가 있는 숫자만("2만원", "10개") 조건으로 보고, 같은 단위 필드가 있는 문서만 거른다(일반 문서는 그대로 후보). 채팅 API 응답에 `sources: [{kind:"db", label}]`를 추가했고 위젯은 답 아래 "출처 보기"로 접어서 보여준다.

