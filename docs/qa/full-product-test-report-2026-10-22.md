# 전체 제품 QA 실행 기록 — 2026-10-22

대상: `codex/workspace-redesign` / `f3ccb63` + 미커밋 사용자·고객사 권한 기반 코드.  
검증: 2026-10-21~22 KST. 화면 캡처: 2026-10-21.  
[결과·화면 캡처 HTML](full-product-test-checklist.html) · [전체 사례 결과 JSON](results/full-product-2026-10-22.json) · [HTTP 검사 JSON](results/http-2026-10-22.json)

## 판정

**출시 보류. 전체 113개 시나리오를 분류했으며 전부 실행/통과한 것은 아니다.**

| 범위 | 통과 | 실패 | 차단·부분 검증 |
| --- | ---: | ---: | ---: |
| 현재 구현 85개 | 30 | 4 | 51 |
| 기획·예정 28개 | 0 | 1 | 27 |

예정 범위의 실패 1건은 아직 구현되지 않은 기능의 완성 판정이 아니라, 현행 위젯의 설정 주입 방어 결함(U01)을 재현한 결과다. 역할별 로그인 L01~L18은 기반 코드만 존재하므로 모두 차단 상태다. 네트워크 오류 주입·다중 브라우저·일부 수동 왕복은 미실행이며, 이미 수행한 단위/HTTP 검증 범위를 각 사례 메모에 구체적으로 남겼다.

## 실행 환경과 범위

- 기존 연결 DB에서는 트랜잭션 롤백 방식의 상담함/권한 이관 DB 검사만 실행.
- 실제 HTTP·화면 검증은 별도 Docker `postgres:16-alpine`, DB `chatbot_qa`, 루프백 포트 55436 사용.
- 앱은 production build 후 `http://localhost:3012`에서 실행. npm 설치 사이트는 `http://127.0.0.1:3013`.
- 테스트용 계정/봇/상담/신청만 사용. 외부 상담 채널은 연결하지 않았고 기존 고객사 모델 키를 복사하지 않음.
- IAB Chromium에서 1360×920, 390×844 및 760/900px 확인. Safari/Edge 등의 독립 브라우저는 미실행.
- HTML의 결과는 이번 실행을 위한 별도 localStorage 키로 저장. 기존 빈 체크리스트/사용자 기록을 덮어쓰지 않는다. 기본 결과 복원·JSON 내보내기/가져오기 제공.
- production build는 배포가 아니다. 운영·프리뷰 배포 상태를 바꾸지 않았다.

## 자동/통합 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 단위 회귀 5개 파일 | 107/107 통과 | operations, proactive, proactive-ai, workspace-inbox, customer-access |
| TypeScript | 통과 | `npx tsc --noEmit` |
| 프로덕션 빌드 | 통과 | `npm run build` |
| 전체 ESLint | 실패 | 기존 파일 오류 13개, 경고 3개 |
| 신규 HTTP QA 파일 ESLint | 통과 | `npx eslint tests/product-qa.integration.ts` |
| 상담함 DB 통합 | 통과·롤백 | 최근 205건 바깥 대기, 검색/선택 보존, 공간 격리 |
| 권한 기반 DB 통합 | 통과·롤백 | 별도 스키마 이관/재실행/키 보존/역할 분리/즉시 회수/충돌/FK |
| 기존 운영 HTTP 통합 | 23개 통과 후 실패 | 상담 인계 요약이 pending인 상태에서 기대한 fallback 검사 실패 |
| 추가 제품 HTTP 검사 | 29/32 통과 | 아래 3개 제품 결함 재현. 실패 시 프로세스 종료 코드 1 |
| 공개 npm 배포물 | 브라우저 초기화 통과 | 새 디렉터리에서 0.1.2 설치 후 배포 dist import, 런처 제거/재설치 |

단위 테스트 수와 체크리스트 사례 수는 서로 다른 기준이며 합산해 시나리오 통과 건수로 사용하지 않는다.

## 발견한 결함과 재현

### QA-01 — 종료 상담이 늦은 답변으로 다시 열림

- 관련: S13. 출시 차단.
- 준비: 같은 테스트 계정 소유의 `chat_sessions` 및 `support_handoffs`가 closed인 상담.
- 동작: 로그인 쿠키로 `POST /api/support/handoffs`에 해당 sessionId와 message 전송.
- 실제: HTTP 200, 메시지 저장, 상담을 human/active로 다시 갱신.
- 기대: 종료 상태를 서버에서 다시 확인하고 답변 저장/재개 거부.
- 동시 accept와 중복 close 안내가 각각 한 번 저장되는 검사는 통과했으나 이 결함을 상쇄하지 않는다.

### QA-02 — 위젯 제목·색상의 위험한 입력 저장 허용

- 관련: T02-02, U01. 출시 차단.
- 동작: 자기 봇 설정 PUT에 HTML 이벤트 속성이 포함된 widget_title과 CSS 문법이 섞인 widget_color 전송.
- 실제: HTTP 200으로 저장. 현행 위젯이 해당 값을 HTML/CSS 템플릿에 삽입하는 경로도 확인.
- 기대: 서버 검증에서 거부하며 기존 저장값/공개 설정 응답/위젯 DOM 구성에도 방어 적용.
- 실제 고객 사이트나 브라우저에서 alert를 실행하지 않았다. 테스트 후 정상 제목/색상으로 복구.

### QA-03 — 폴더 없는 Q&A가 실제 위젯에서 누락

- 관련: T03-08.
- 준비: folder_id가 NULL인 Q&A 1건.
- 실제: 관리자 테스트의 ‘배송 일정’ 선택에는 나타나고 답변도 표시되지만, 공개 `/api/widget/[botId]`의 qaFolders에는 빠져 실제 설치 위젯에 선택지가 없음.
- 기대: 폴더 없는 Q&A도 정해진 기본 그룹/직접 질문 목록으로 노출하거나, 저장 시 지원하지 않는 상태를 명확히 제한.
- 공개 npm SDK로 설치한 위젯에서도 재현.

### QA-04 — 요약 작업의 최초 검사 타이밍 실패

- 관련: T07-02, 운영 통합 테스트.
- 최초 기존 통합 스크립트는 상담 접수 후 요약 pending 때문에 실패. 해당 실패 기록을 유지.
- 후속 `processJobs()` 실행에서는 fallback 요약 저장 확인.
- 작업 생성 시각/available_at, after 처리와 폴링 간격에 대한 재현·회귀 보완 필요. 현재 근거만으로 영구적인 요약 장애라고 단정하지 않음.
- 실제 AI 요약은 전용 모델 키가 없어 미실행.

### QA-05 — 전체 린트 오류

- `app/admin/AdminClient.tsx`: JSX의 이스케이프되지 않은 따옴표 2건.
- `app/demo/page.tsx`: 같은 규칙 오류 6건.
- `app/analytics/AnalyticsDashboard.tsx`: effect에서 동기적으로 호출되는 상태 갱신 규칙 1건.
- `app/api/external/chats/route.ts`: 명시적 any 3건.
- `app/GuidePanel.tsx`: effect에서 동기적으로 호출되는 상태 갱신 규칙 1건.
- 합계 오류 13건.
- 추가 경고 3건: img 최적화 2건 및 사용하지 않는 표현식 1건.

## 실행/재현 명령

```bash
node --import tsx --test tests/operations.test.ts tests/proactive.test.ts tests/proactive-ai.test.ts tests/workspace-inbox.test.ts tests/customer-access.test.ts
npx tsc --noEmit
npx eslint app lib auth.ts middleware.ts scripts tests
npm run build
WORKSPACE_DB_CHECK=1 node --env-file=.env.local --import tsx tests/workspace-inbox.integration.ts
ACCESS_DB_CHECK=1 node --env-file=.env.local --import tsx tests/customer-access.integration.ts
```

`tests/product-qa.integration.ts`는 전용 로컬 DB(`localhost/127.0.0.1`, DB 이름 `chatbot_qa`)와 포트 3012만 허용한다. 기존 운영 통합 스크립트가 남긴 `/tmp/ideal-ai-operations-fixture.json`의 테스트 계정으로 다시 로그인하며, fixture를 만들지 않고는 실행할 수 없다. 이 파일에는 테스트 자격 증명이 있어 저장소/보고서에 포함하지 않는다.

```bash
# 다음 환경 파일은 Docker 전용 QA DB 접속값이어야 한다. .env.local로 대체하지 말 것.
OPERATIONS_TEST_URL=http://localhost:3012 OPERATIONS_KEEP_FIXTURE=1 \
  node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/operations.integration.ts
# 기존 스크립트가 요약 타이밍에서 실패해도 fixture는 앞서 저장되어 있을 수 있다.
OPERATIONS_TEST_URL=http://localhost:3012 \
  node --env-file=/tmp/chatbot-qa-runtime/app.env --import tsx tests/product-qa.integration.ts
```

전용 환경의 테스트 데이터는 후속 확인을 위해 Docker 컨테이너 `chatbot-qa-20261021`에 남겨두었다. 기존 운영 통합 스크립트의 processJobs/cleanupOperations는 연결 DB의 전체 작업을 처리할 수 있으므로, 공유/운영 DB를 가리킨 채 HTTP 스크립트를 실행하지 않는다. 컨테이너와 임시 환경 파일은 이번 QA가 끝나고 필요 없을 때 정리한다.

## 캡처

HTML 하단에 17개 화면을 base64로 내장했다. 확대 보기와 인쇄를 지원한다. 캡처는 10/21 당시의 fixture 상태이며 10/22 재검증 중 보존 기간 경과로 기존 신청이 정리되고 새 테스트 신청이 생성돼 숫자와 내용이 달라질 수 있다. 원본은 `docs/verification/qa-2026-10-21/`에 보관한다.

새 상담사 로그인·고객사 구성원 관리 화면은 아직 구현되지 않아 캡처를 만들어 표시하지 않았다. ‘파트너 작업 공간’ 캡처는 현행 소유자 화면이다.
