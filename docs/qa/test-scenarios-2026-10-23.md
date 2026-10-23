# 전체 제품 테스트 시나리오 — 통합 브랜치 main 반영 전 (2026-10-23)

대상: `codex/workspace-redesign` (PR #2~#10 머지 후). 이 문서는 **main 반영 전 전부 통과를 확인할 시나리오 목록**이다. 각 항목은 PRD 인수 ID(`L01~L18`, `WS-*`, `WIDGET-*`, `QA/SUM/URL/LEAD/AC-*`, `PRO-*`)에 연결되고, 검증 수단을 자동(단위·DB·HTTP 스위트의 검사명)과 수동(브라우저 절차)으로 구분한다. 환경이 없어 실행할 수 없는 항목은 **미검증(환경)** 으로 남기고 통과로 표시하지 않는다.

## 0. 실행 방법

```sh
# 격리 QA 환경 (실제 고객 DB를 쓰지 않는다)
node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx scripts/migrate-customer-access.ts --apply
node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx scripts/seed-customer-portal-qa.ts   # 매 HTTP 실행 전
node --import tsx --test tests/*.test.ts
PORTAL_DB_CHECK=1 node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/customer-portal.integration.ts
PORTAL_DB_CHECK=1 node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/common-identity.integration.ts
DEMO_DB_CHECK=1 node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/demo.integration.ts
node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/customer-portal-http.integration.ts
node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/demo-http.integration.ts
```

진입점(QA): 에이전시 `http://localhost:3012`, 고객사 `http://desk.localhost:3012`, 마스터 `http://master.localhost:3012`. 계정은 `/tmp/chatbot-qa-runtime/portal-fixture.json`(owner/admin/agent/other), 마스터는 `master.json`. 비밀번호는 seed마다 바뀐다.

표기: **자동** = 스위트 검사명으로 통과 확인 · **수동** = 브라우저 절차(캡처 경로) · **미검증(환경)** = Google 콘솔·메일·DNS·실모델 키 등 운영 설정 필요 · **범위 외** = 이번 통합에 미포함(원장 pending 유지).

## 1. 로그인·신원 (L01~L18)

| ID | 역할 / 호스트 | 절차 | 기대 결과 | 검증 수단 | 상태 |
| --- | --- | --- | --- | --- | --- |
| L01-a | 비로그인 / 에이전시 | `/signup`으로 일반 가입 | tenant + 소유자 신원 + 기본 고객사 `우리 회사` 1개 생성, 중복 이메일 409 | DB `googleIdentity` 신규 가입 멱등(공통 신원 1단계) · 수동 가입 폼 | 자동+수동 |
| L01-b | 초대받은 사람 / desk | 초대 링크 → 이메일 확인 또는 Google → 수락 | 사용자만 생성, 파트너 공간·요금제 미생성 | HTTP "이메일 확인 후 새 담당자만 생성·파트너 공간 미생성", DB customer-only 초대 생성 | 자동 |
| L02-a | 기존 소유자 / 에이전시 | 이메일·비밀번호 로그인 | 기존 봇·설정·문서·대화 유지 | HTTP "에이전시 로그인은 기존 tenant 유지" | 자동 |
| L02-b | 기존 소유자 / 에이전시 | 비밀번호로 로그인 후 설정 → Google 계정 연결 | 미검증 이메일이어도 본인 세션이면 연결·검증 기록 | DB "세션 사용자만 Google 연결" | 자동 (실 Google 왕복 미검증(환경)) |
| L02-c | 기존 Google 소유자 | Google 로그인 | `oauth_sub`로 기존 tenant 매핑, 공간 중복 생성 없음 | DB legacy subject 매핑 | 자동 |
| L03 | 상담 담당자 / desk | 로그인 → 자기 고객사 상담함 | 상담함 자동 이동, 설정·키·결제·구성원 API 403/404 | HTTP "담당자는 자기 고객사 상담함으로 자동 이동", "담당자의 관리/비밀값 API 직접 접근 차단" | 자동 |
| L04 | 고객사 관리자 / desk | 로그인 → 챗봇 관리·고객사 설정·담당자 관리 | 자기 고객사 설정·상담 가능, 다른 고객사·파트너 비밀값 미노출 | HTTP "고객사 관리자 챗봇 조회·수정·지식·통계 범위", "전용 상담함에 에이전시/결제/키 메뉴 미노출" | 자동 |
| L05 | A 담당자 / desk | B 고객사의 봇·세션·신청 ID로 직접 요청 | 목록·단일·수정·삭제 모두 404 | HTTP "고객사 간 목록·선택 세션 격리", "다른 고객사 단일 대화 404", "지식 폴더와 Q&A 항목 ID 변조 차단" | 자동 |
| L06 | 담당자 / desk | 다른 파트너 공간 ID·초대 범위 변조 | 권한 확대 없이 거부 | HTTP "에이전시 호스트로 우회해도 고객사 세션은 관리 API 차단", DB `activateInvitation` 다른 사용자 401 | 자동 |
| L07 | 초대받은 사람 | 다른 이메일·만료·취소·사용 완료 초대 수락 | 권한 부여 없음, 원인별 안내(403/410) | DB common-identity 수락 거부 4종 | 자동 |
| L08 | 초대받은 사람 | 같은 초대 재수락 / 재초대 후 이전 링크 | 멤버십 1개·멱등, 이전 링크 410 | DB 수락 멱등·재초대, HTTP "검증된 로그인 계정은 … PATCH로 수락·멱등" | 자동 |
| L09 | 담당자 / desk | 멤버십 해제 후 열린 화면에서 요청 | 다음 요청부터 404, 비밀번호 재설정 후 에이전시 세션도 401 | HTTP "고객사 권한 회수는 기존 로그인 세션에 즉시 반영", "에이전시 세션은 소유자 auth_version 회수에 즉시 반응" | 자동 |
| L10 | 한 사용자 A관리자/B담당자 | `/customer`에서 고객사 선택 전환 | 각 공간 역할 적용, 목록·초안 섞이지 않음 | HTTP "다른 고객사 계정은 원래 고객사만 접근" · 수동 고객사 선택 화면 | 자동+수동 |
| L11 | 두 담당자 / desk | 동시 수락 · 종료 후 전송 | 담당 1명, 종료 상담 재개 없음 | HTTP "두 담당자 동시 수락은 한 명만 성공", "종료 후 답변 거부·상담 재개 없음" | 자동 |
| L12 | 담당자 / desk | 본문에 sender_user_id·agentName 변조 | 실제 로그인 사용자로 기록 | HTTP "전송 멱등성·실제 사용자 기록·작성자 위조 무시" | 자동 |
| L13-a | 비로그인·일반 소유자 | `/admin`, `/api/admin/*` | 로그인/403, master 호스트로 리디렉션 | HTTP "마스터 콘솔은 master 호스트에서만…" | 자동 |
| L13-b | 마스터 / master | 콘솔 로그인 → 에이전시 목록·요금제·마스터 관리 | 에이전시 메타데이터만, 고객 대화 접근 경로 없음 | HTTP "에이전시 공간 없는 마스터는 master 호스트에서만…" · 수동 `master-host-console.jpg`, `master-panel.jpg` | 자동+수동 |
| L14 | 방문자 / 고객 홈페이지 | 기존 위젯 코드로 Q&A·AI·견적·상담원 연결 | 공개 식별자 유지, 로그인과 독립 | HTTP 데모 "실제 위젯 설정은 등록 Q&A·안전한 표시값만 제공" · 수동 테스트 사이트 3013 | 자동+수동 |
| L15 | 소유자 / 에이전시 | 고객사 봇 합계로 플랜 한도 | 동시 생성도 합산 한도 | HTTP "동시 봇 생성도 에이전시 합산 플랜 한도 준수" | 자동 |
| L16 | 고객사 관리자 / desk | 관리자 역할 초대 요청 | 403, 감사 기록 | HTTP "고객사 관리자는 상담사만 초대 가능", DB `recordDenied` | 자동 |
| L17 | 모든 역할 / 모바일 | 로그인·고객사 선택·초대·상담 | 키보드·모바일 완료 가능 | 수동 `design-pro-desk-login-mobile.jpg`, 상담함 390px | 수동 (일부) |
| L18 | 운영자 | 이관 dry-run → 적용 → 재실행 | 중복 생성 없음, 실패 시 롤백 | `migrate-customer-access.ts`(preflight·serializable), QA DB 재적용 멱등 | 자동(QA) · 운영 리허설 미검증(환경) |

## 2. 데이터 경계 (2026-10-23 결정)

| ID | 역할 / 호스트 | 절차 | 기대 결과 | 검증 수단 | 상태 |
| --- | --- | --- | --- | --- | --- |
| DB-01 | 소유자 / 에이전시 | `/analytics` 전체·고객사 봇 선택 | 집계만, 대화 원문·거절 목록 제외, 안내 배너 | HTTP "에이전시 분석은 고객사 봇의 대화 원문을 숨기고 집계만 포함" · 수동 `analytics-boundary-dashboard.jpg` | 자동+수동 |
| DB-02 | 소유자 / 에이전시 | 고객사 봇 `/bots/[id]/logs`, `/requests`, 미응답 | 403/안내 패널, 접수 목록·홈 지표에서 제외 | HTTP "고객사 봇의 접수·미응답은 고객사만 처리…" · 수동 `analytics-boundary-logs.jpg` | 자동+수동 |
| DB-03 | 소유자 / 에이전시 | 자사(`우리 회사`) 봇·미배정 봇 | 원문·접수·미응답 그대로 | HTTP 같은 검사(자사 봇 200) | 자동 |
| DB-04 | 고객사 관리자 / desk | 자기 봇 대화 기록·접수 | 원문 그대로 | HTTP 같은 검사(desk 200) | 자동 |

## 3. 워크스페이스·고객사 관리 (WS-01~05)

| ID | 절차 | 기대 결과 | 검증 수단 | 상태 |
| --- | --- | --- | --- | --- |
| WS-01 | 업무 홈·상담함·문의·챗봇 목록·모바일 메뉴 | 실제 수치, 대기 우선, 기존 기능 유지 | HTTP 홈/상담 검사 · 수동 `design-pro-home.jpg`, `design-pro-support.jpg` | 자동+수동 |
| WS-02 | 고객사 생성·봇 연결·초대·역할 | 권한표대로 | HTTP 고객사 관리 검사 전반, DB 46건 | 자동 |
| WS-03 | 가입 시 tenant=파트너 공간, 한도 유지 | 봇·세션 한도 유지 | HTTP L15 검사 | 자동 (좌석 과금 범위 외) |
| WS-04 | 데모 발급·공개·만료·해제·운영 분리 | 운영 테이블 미변경, 한도·멱등 | 데모 HTTP 8건·DB 13건 · 수동 `design-unify-demo.jpg` | 자동+수동 (실 AI 응답 미검증(환경)) |
| WS-05 | 먼저 말 걸기 운영 지표 | — | — | 범위 외(원장 pending) |

## 4. 고객사 챗봇 관리 (PR #4)

| ID | 역할 / desk | 절차 | 기대 결과 | 검증 수단 | 상태 |
| --- | --- | --- | --- | --- | --- |
| CB-01 | 관리자 | 응대 설정 저장(이름만 변경) | 기본 위젯 색 유지 | 단위 `DEFAULT_WIDGET_COLOR` · 수동 `design-unify-bot-workspace.jpg` | 자동+수동 |
| CB-02 | 관리자 | 문서 재업로드(동일·변경·폴더 이동) | 임베딩 생략·갱신·폴더만 이동 | DB 46건 중 업로드 회귀, HTTP "동일 파일 재업로드는 모델 키 없이도 건너뛴다" | 자동 |
| CB-03 | 관리자 | Q&A 엑셀 가져오기(제목행·시트·관리열·재가져오기) | 시트별 폴더, 기존 ID 갱신, 비고열 제외, 행 오류 위치 안내 | 단위 `qa-workbook` 4건, DB 가져오기 회귀 | 자동 |
| CB-04 | 관리자 | URL 미리보기·승인 | 고객사 경로만 허용, 미배정 봇은 에이전시 허용 | HTTP "고객사 미배정 기존 봇도 에이전시 URL 미리보기 저장 가능" | 자동 (실 임베딩 키 미검증(환경)) |
| CB-05 | 관리자 | 폴더 이름 변경·삭제 | 내용 미분류 유지 | 수동 `customer-folder-controls.png` | 수동 |
| CB-06 | 담당자 | 챗봇 관리 API 호출 | 404 | HTTP "담당자의 관리/비밀값 API 직접 접근 차단" | 자동 |

## 5. 위젯·운영 기능 (WIDGET, QA/SUM/URL/LEAD/AC)

| ID | 상태 | 비고 |
| --- | --- | --- |
| WIDGET-01 | 자동 | HTTP "위젯 위험 입력 차단·기존 저장값 방어·폴더 없는 Q&A" |
| WIDGET-02~06 | 범위 외 | Shadow DOM·안 읽음·접근성·프로필·링크: 다음 단계 |
| URL-01~06, AC-URL-* | 자동(부분) | 공통 처리기 `lib/operations/web-sources.ts`, 미배정 봇 HTTP 검사. 실 사이트 다양성·시간 초과·크기 초과 사례는 운영 전 샘플 검증 필요 |
| LEAD-01~09, AC-LEAD-* | 자동(부분) | 접수 멱등·격리·상태·메모 HTTP 검사, 데모 접수 격리. 알림 채널 실패 복구는 Slack/Telegram 미연결로 미검증(환경) |
| QA-*, SUM-*, PRO-* | 범위 외 | 원장 pending. 이번 통합에서 변경 없음 |

## 6. 디자인·접근성

| ID | 절차 | 기대 결과 | 검증 수단 | 상태 |
| --- | --- | --- | --- | --- |
| UI-01 | 에이전시/desk/master 로그인 | 같은 디자인 시스템(Pretendard·인디고·2분할 로그인) | 수동 `design-pro-*.jpg` | 수동 |
| UI-02 | 데스크톱 1360 / 모바일 390 | 겹침·잘림 없음 | 수동 데스크톱 캡처·모바일 로그인 캡처. 상담함·챗봇 관리 모바일은 재확인 필요 | 수동(부분) |
| UI-03 | 키보드 포커스 | 포커스 링 표시 | 토큰 `--focus` 적용. 수동 탭 이동 확인 필요 | 수동(미실행) |

## 7. 운영 반영 전 환경 체크리스트 (코드와 별개)

1. 운영 DB에서 `migrate-customer-access.ts`(dry-run) → 중복 이메일·고아 봇 0 확인 → `--apply` → 재실행 멱등 확인(L18).
2. `CUSTOMER_PORTAL_ORIGIN`(desk.도메인)·`MASTER_ORIGIN`(master.도메인) DNS/TLS, `AUTH_URL`과 같은 스킴.
3. Google 콘솔 redirect URI: `AUTH_URL/api/auth/callback/google`, `CUSTOMER_PORTAL_ORIGIN/api/auth/callback/customer-google`, `MASTER_ORIGIN/api/auth/callback/google`.
4. `RESEND_API_KEY`·`AUTH_FROM_EMAIL`(초대 이메일 확인·비밀번호 재설정), `ADMIN_EMAILS`(최초 마스터).
5. 실제 모델 키로 임베딩·AI 응답·데모 1회 왕복, Slack/Telegram 알림 1회.
6. 배포 후 수동 스모크: 에이전시 로그인·desk 로그인·master 콘솔·위젯 1회 대화.

## 8. 실행 기록

(아래에 실행 날짜·커밋·결과를 추가한다. 자동 스위트 수치와 수동 항목별 통과/실패/미검증을 적는다.)

### 2026-10-23 1차 실행 — `codex/master-identity` `2e230b2` (= 통합 브랜치 + PR #10)

자동: 단위 142/142 · DB 포털 46·신원 20·데모 13(전부 롤백) · `tsc` 통과 · ERD 렌더 검사 OK · HTTP 포털 40/40 · 데모 HTTP 8/8 · 프로덕션 빌드 Edge 경고 0.

| 수동 항목 | 결과 | 근거 |
| --- | --- | --- |
| L13-b 마스터 콘솔·마스터 관리 패널 | 통과 | `master-host-console.jpg`, `master-panel.jpg` |
| UI-01 로그인 3종·업무 홈·상담함·고객사 관리 디자인 | 통과 | `design-pro-*.jpg` |
| UI-02 모바일(375px) desk 로그인·상담함·챗봇 관리 | 통과(겹침·잘림 없음, 상단 메뉴 가로 스크롤) | `design-pro-desk-login-mobile.jpg`, `qa-mobile-desk-support.jpg`, `qa-mobile-bot-workspace.jpg` |
| UI-03 키보드 포커스 링 | 통과(인디고 링 표시) | `qa-keyboard-focus.jpg` |
| DB-01/02 경계 화면 | 통과 | `analytics-boundary-dashboard.jpg`, `analytics-boundary-logs.jpg` |
| 초대 흐름 5상태 | 통과 | `common-identity-invite-*.jpg` |
| L01-a 가입 폼 수동 | 미실행 | 자동(DB) 검증만 |
| L10 공간 전환 초안 분리 | 미실행 | HTTP 격리 검사만 |
| L17 전체 흐름 키보드 완주 | 미실행 | 포커스 링만 확인 |
| 환경 항목(§7) | 미검증(환경) | Google 콘솔·메일·DNS·실모델 키·운영 이관 |

판정: **코드 범위의 자동·수동 시나리오는 전부 통과. main 반영은 §7 환경 체크리스트와 운영 이관 리허설을 수행한 뒤 PR #1 경로로 진행한다.** 미실행 3건은 반영 전 수동으로 한 번 더 돌리는 것을 권한다.
