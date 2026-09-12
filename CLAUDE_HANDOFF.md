# IDEAL AI Chatbot SDK — Claude Code 핸드오버

최종 갱신: 2026-09-12

## 1. 작업 위치와 현재 상태

- 실제 프로젝트: 이 `CLAUDE_HANDOFF.md`가 있는 `chatbot-sdk` 디렉터리.
- Git 브랜치: `main`
- 기준 커밋: `c329e9a merge: sync latest main with analytics work`
- **아직 아무것도 커밋하지 않았다.** 작업 트리에 사용자의 기존 변경 + 이번 Slack 작업이 함께 있다. `git reset`, `git checkout --`, 일괄 롤백을 하지 말 것.
- 로컬 개발 서버는 `http://localhost:3001`에서 `next dev`로 이미 떠 있는 경우가 많다 (Next.js 16.3.0 / Turbopack). Next는 같은 디렉터리에 두 번째 dev 서버를 허용하지 않으므로, 다른 포트로 새로 띄우려 하지 말고 **기존 3001 서버를 그대로 쓸 것**. 핫리로드로 변경이 반영된다.
- MVP 상담원 채널: **자체 상담함 + Telegram + Slack**. WhatsApp, KakaoTalk, Teams는 제외.

## 2. 제품 요구사항

웹 위젯의 Q&A/AI 챗봇이 답변하다가 고객이 요청하거나 답변에 실패하면 상담원으로 이관한다.

```text
고객 웹챗
   ↕
IDEAL AI DB (세션·메시지의 유일한 기준 저장소)
   ↕
자체 상담함 / Telegram Topic / Slack Thread
```

필수 동작 (전부 구현 완료):

1. 상담 요청 시 자체 상담함에 항상 상담 건을 생성한다.
2. 연결된 Telegram에는 상담 건별 Forum Topic을 생성한다.
3. 연결된 Slack에는 상담 건별 루트 메시지/Thread를 생성한다.
4. 고객의 추가 메시지를 연결된 모든 채널에 동기화한다.
5. 어느 채널에서 답해도 DB에 한 번만 저장하고 고객 웹챗에 전달한다.
6. 한 채널에서 `/close` 또는 상담 종료를 하면 전체 채널 상태를 종료로 동기화한다.
7. 외부 이벤트는 `source + external_message_id`로 멱등하게 처리한다.

## 3. 상담원 연결이 발생하는 조건

**자동 이관은 없다. 항상 고객이 버튼을 눌러야 한다.** 챗봇은 "상담원 연결 버튼을 노출할지"만 판단한다.

대전제: `bots.support_mode === "hybrid"`일 때만 동작. `unattended`면 버튼이 없고 API도 409로 막힌다.

고객 진입 경로 4가지:

1. **상시 노출 상단 바** — hybrid면 `상담원 연결` 버튼이 위젯 상단에 항상 떠 있다 (`public/chatbot-widget.js` supportBar).
2. **Q&A 첫 메뉴 선택지** — 폴더/질문 목록에 `상담원 연결` 항목이 함께 표시된다.
3. **답변 실패 시 뜨는 `상담원에게 문의하기` 버튼** — 서버가 `handoffAvailable: true`를 줄 때만. `app/api/chat/[botId]/route.ts` 기준:
   - Q&A 봇: 질문 매칭 실패(`!match`) 또는 답변이 거절 문구
   - Q&A 선택형: 고른 답변이 거절 문구
   - AI(문서) 봇: 관련 문서 0건 또는 답변이 거절 문구
4. **SDK/직접 API 호출** — `POST /api/chat/{botId}/handoff`

거절 판정은 `lib/analytics.ts`의 `detectRefusal()` — **단순 키워드 매칭**이다
(`답변을 찾지 못했습니다 / 도와드릴 수 없 / 제공할 수 없 / 답변할 수 없 / 처리할 수 없`, 영문 `can't help` 등).

서버측 거부 조건 (`app/api/chat/[botId]/handoff/route.ts`):
`X-Bot-Token` 불일치 401 / 분당 20회 초과 429 / unattended 409 / 구독 비활성 403 / 월 세션 한도 초과 429 / 이미 열린 상담이 있으면 신규 생성 없이 기존 건 반환.

## 4. 구현 완료 내용

### 상담 공통 기반

- `bots.support_mode`: `unattended` / `hybrid`
- `bots.public_token`: 공개 챗 API의 `X-Bot-Token`
- `chat_sessions` / `chat_messages` / `support_handoffs` / `api_rate_limits`
- 웹 위젯 세션은 `localStorage`에 유지되며 2.5초 간격으로 상담원 답변을 폴링한다.
- Q&A 봇은 처음에 직접 입력창을 숨기고 `직접 질문하기`를 누르면 표시한다.
- `/support`에 자체 상담 대기열과 대화 UI가 있다.

### Telegram

- 챗봇별 Bot Token, Supergroup Chat ID를 암호화 저장.
- 상담 요청 시 Forum Topic 생성 + 기존 대화 내역 전송.
- Topic 답변을 웹챗 상담원 메시지로 저장, `/close`로 종료.
- Slack이 연결돼 있으면 Telegram 상담원 답변/종료를 Slack Thread에 `[Telegram 상담원] ...`로 미러링.

### Slack (2026-09-12 완료)

- 설정 API: `app/api/bots/[id]/integrations/slack/route.ts`
  - `GET` 연결 상태/channel/team (민감값 제외), `PATCH` 저장
  - Bot Token · Signing Secret은 `lib/crypto.ts`의 `encrypt()`로 암호화, 빈 값이면 기존 값 유지
  - 저장 시 `auth.test` → `team_id` 기록 → `conversations.join`(실패 무시) → `chat.postMessage` 연결 테스트
  - 소유권 검사는 Telegram과 동일한 `ownedBot()` 패턴
- Events webhook: `app/api/integrations/slack/[botId]/events/route.ts`
  - `req.text()`로 raw body를 먼저 읽고 `verifySlackSignature()` 검증
  - `url_verification` 처리, 봇 메시지/subtype echo 무시
  - `channel + (thread_ts || ts)`로 handoff 매핑, external ID는 `${channel}:${ts}`
  - waiting → active/human 전환, `sender=agent, source=slack` 저장
  - `/close` 시 handoff·session 종료 + Telegram Topic에도 종료 통지
  - 상담원 이름은 `users.info` best-effort (스코프 없으면 "Slack 상담원" 폴백)
- 상담 생성 시 Slack root 메시지 생성 → `support_handoffs.slack_channel_id` / `slack_thread_ts` 저장, 응답에 `slackConnected`
- 고객 추가 메시지 / 자체 상담함 답변 / 종료를 Telegram·Slack에 팬아웃
- 설정 UI: `상담원 연결 채널` 섹션에 Telegram 카드 + Slack 카드(Token/Secret/Channel ID, 상태, 저장·테스트, Request URL·필요 스코프 안내)

### 공통 헬퍼

`lib/support.ts`의 `fanOutToSupportChannels(botId, refs, text, skip?)` — 연결된 Telegram Topic / Slack Thread에 같은 문구를 병렬 미러링하고, 한 채널 실패가 다른 채널과 DB 저장을 막지 않는다.

### 중복 방지 설계

- `chat_messages`에 `(source, external_message_id)` 유니크 인덱스. Slack은 채널 ID를 external ID에 포함해 충돌을 막는다.
- 중복 webhook 이벤트는 `saveChatMessage()`가 `null`을 반환하므로, **미러링도 함께 건너뛴다.** 중복 저장/중복 전송이 모두 발생하지 않는다.
- 각 채널 webhook은 자기 봇이 보낸 echo를 무시한다.

## 5. 핵심 파일 맵

- DB 스키마: `lib/db.ts`
- 암호화: `lib/crypto.ts`
- 상담/외부 채널 공통 헬퍼: `lib/support.ts`
- 거절 판정: `lib/analytics.ts` (`detectRefusal`)
- 공개 챗 API: `app/api/chat/[botId]/route.ts`
- 이관 생성/상태 조회: `app/api/chat/[botId]/handoff/route.ts`
- 이관 후 고객 메시지: `app/api/chat/[botId]/handoff/message/route.ts`
- Telegram 설정: `app/api/bots/[id]/integrations/telegram/route.ts`
- Telegram webhook: `app/api/integrations/telegram/[botId]/webhook/route.ts`
- Slack 설정: `app/api/bots/[id]/integrations/slack/route.ts`
- Slack webhook: `app/api/integrations/slack/[botId]/events/route.ts`
- 자체 상담 API: `app/api/support/handoffs/route.ts`
- 자체 상담 UI: `app/support/page.tsx`
- 챗봇 설정 UI: `app/bots/[id]/BotSettings.tsx`
- 웹 위젯: `public/chatbot-widget.js`
- npm SDK: `packages/chatbot-sdk/src/index.ts`
- 전체 API/MCP 초안: `API_REFERENCE_MCP.md`

## 6. 검증 상태

2026-09-12 기준 **전부 통과**:

```bash
npx tsc --noEmit                              # 0
node --check public/chatbot-widget.js         # ok
npm run build                                 # 0
npm --prefix packages/chatbot-sdk run build   # 0
```

런타임 확인 (localhost:3001 dev 서버):

- `/` 로그인 화면 정상 렌더
- `POST /api/integrations/slack/{botId}/events` → 서명 없으면 `401 Unauthorized` (라우트 등록 + 서명 검증 동작 확인)
- middleware의 `/api/integrations/slack/` 공개 prefix 정상 적용

## 7. 남은 일 — 수동 통합 테스트

코드는 완성됐고 **실계정 end-to-end 테스트만 남았다.** 로컬 그대로는 불가하고 ngrok 터널 또는 preview/운영 배포가 필요하다 (Slack Events Request URL과 Telegram webhook 모두 외부 HTTPS 필요).

1. 개발 로그인 후 하이브리드 챗봇 설정 열기
2. Telegram 연결 저장·테스트
3. Slack 연결 저장·테스트 → Slack App의 Event Subscriptions Request URL에 `${origin}/api/integrations/slack/${botId}/events` 등록
4. 외부 위젯에서 상담원 연결 요청
5. `/support`, Telegram Topic, Slack Thread 모두에 같은 상담이 생성되는지 확인
6. 각 채널에서 답변 → 웹챗에 중복 없이 한 번만 표시되는지 확인
7. Telegram `/close`, Slack `/close`, 자체 UI 종료가 각각 모든 채널에 반영되는지 확인
8. 검증 후 작업 내용을 커밋

### Slack App 필요 설정

- Bot Scope: `chat:write`, `channels:join`(public 채널 자동 참여 시), `users:read`(상담원 이름 표시 시)
- 이벤트 구독: `message.channels` (비공개 채널이면 `message.groups`)
- 대상 채널에 봇을 먼저 초대해두는 방식을 권장

## 8. 환경 변수

코드에서 참조하는 키 이름만 기록한다. **실제 값은 문서에 기록하지 말 것.**

- `POSTGRES_URL`, `ENCRYPTION_KEY`, `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAILS`, `CRON_SECRET`, `MASTER_KEY`
- `NEXT_PUBLIC_DEMO_BOT_ID`
- `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SMS_FROM`

Slack/Telegram 인증정보는 환경 변수가 아니라 챗봇별 `slack_integrations` / `telegram_integrations`에 암호화 저장하는 설계다.

## 9. 알고 있는 주의점

- `.env.local`에 Auth.js secret이 없으면 `MissingSecret` 경고가 날 수 있다. 개발 로그인은 그래도 작동했다.
- `initSchema()`는 앱 실행 시 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... IF NOT EXISTS`로 스키마를 점진 보정한다. 초기 로그 NOTICE는 정상.
- Telegram webhook은 localhost에 자동 등록하지 않는다 (설정 API가 localhost/127.0.0.1이면 `setWebhook`을 건너뛴다).
- Slack Bot Token, Signing Secret, Telegram Bot Token, `public_token`을 로그/문서/최종 응답에 노출하지 말 것.
- 테스트용 상담 레코드 `test-handoff-20260912`가 DB에 남아 있을 수 있다.
- `.claude/launch.json`은 이번에 만든 개발 서버 실행 설정이다. 3001 dev 서버를 직접 쓰는 경우 불필요하므로 지워도 무방하다.
- `AGENTS.md`(= `CLAUDE.md`)는 `next dev`가 자동으로 다시 써 넣는 블록을 포함한다. diff에서 지워도 재생성되므로 작업과 함께 커밋하는 편이 트리가 깨끗하다.

## 10. 알려진 개선 여지 (미착수)

- `detectRefusal()`이 키워드 매칭이라 취약하다. AI 봇이 "정확한 정보가 없네요" 같은 다른 표현을 쓰면 거절로 잡히지 않아 `상담원에게 문의하기` 버튼이 뜨지 않는다. 상단 상시 바가 있어 고객이 막히지는 않지만, 문구 확장이나 문서 유사도 임계치 기반 판정으로 바꾸는 것을 고려할 만하다.
- Slack은 3초 내 응답을 요구한다. 현재는 webhook 안에서 외부 API 호출을 동기로 수행하므로, 트래픽이 늘면 큐/비동기 처리로 옮기는 것을 고려할 것. 현 MVP에서는 DB 멱등성으로 중복 재시도를 흡수한다.
