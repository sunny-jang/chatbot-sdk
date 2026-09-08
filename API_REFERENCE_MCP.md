# IDEAL AI Chatbot API 및 MCP 연동 목록

현재 `app/api` 구현을 기준으로 정리한 문서입니다. 총 44개 HTTP 메서드가 있습니다.

## 인증 구분

- `세션`: `tenant_id` 쿠키 또는 Auth.js 로그인 세션이 필요합니다.
- `관리자`: `is_admin` 쿠키 또는 관리자 Auth.js 세션이 필요합니다.
- `서비스 키`: `Authorization: Bearer <MASTER_KEY>`가 필요합니다.
- `Cron 키`: `Authorization: Bearer <CRON_SECRET>`가 필요합니다.
- `공개`: 별도의 로그인 없이 호출됩니다.
- 현재 생성되는 테넌트 API 키(`iai-...`)는 외부 API 인증에 사용되지 않습니다. MCP 연동 전 Bearer API 키 인증을 추가해야 합니다.

## 1. 인증 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 공개 |
|---|---|---|---|---|---|
| POST | `/api/auth/signup` | 공개 | `{ name, email, password, phone }` | `{ ok, name }` | 제외 |
| POST | `/api/auth/login` | 공개 | `{ email, password }` | `{ ok, name }` 및 세션 쿠키 | 제외 |
| POST | `/api/auth/logout` | 세션 | 없음 | `{ ok }` | 제외 |
| POST | `/api/auth/dev-login` | 개발 환경만 | 없음 | `{ ok, name }` | 제외 |
| POST | `/api/auth/phone-verify` | 공개 | `{ phone }` | OTP 발송 결과 | 제외 |
| PUT | `/api/auth/phone-verify` | 공개 | `{ phone, code }` | `{ ok }` | 제외 |
| GET/POST | `/api/auth/[...nextauth]` | Auth.js | OAuth 동작별 상이 | Auth.js 응답 | 제외 |

## 2. 챗봇 관리 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| GET | `/api/bots` | 세션 | 없음 | 챗봇 목록 | `list_bots` |
| POST | `/api/bots` | 세션 | `{ name, type, system_prompt?, model? }` | 생성된 챗봇 | `create_bot` |
| GET | `/api/bots/{id}` | 세션 | 경로 `id` | 챗봇 상세 | `get_bot` |
| PUT | `/api/bots/{id}` | 세션 | `{ name?, system_prompt?, model?, widget_title?, widget_color?, greeting_message? }` | 수정된 챗봇 | `update_bot` |
| DELETE | `/api/bots/{id}` | 세션 | 경로 `id` | `{ ok }` | `delete_bot` (확인 필요) |
| POST | `/api/bots/{id}/generate-prompt` | 세션 | `{ description }` | `{ systemPrompt }` | `generate_bot_prompt` |
| POST | `/api/generate-prompt` | 세션 | `{ description }` | `{ systemPrompt }` | 위 도구로 통합 권장 |

챗봇 생성은 플랜별 챗봇 수 제한과 구독 상태를 검사합니다.

## 3. 문서 및 폴더 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| GET | `/api/bots/{id}/docs` | 세션 | 경로 `id` | 문서 목록 | `list_documents` |
| POST | `/api/bots/{id}/docs` | 세션 | `{ title, content, folder_id? }` | 생성된 문서 | `create_document` |
| PATCH | `/api/bots/{id}/docs/{docId}` | 세션 | `{ folder_id }` | 이동된 문서 | `move_document` |
| DELETE | `/api/bots/{id}/docs/{docId}` | 세션 | 경로 ID | `{ ok }` | `delete_document` (확인 필요) |
| POST | `/api/bots/{id}/docs/upload` | 세션 | multipart: `files[]`, `paths[]?`, `folder_id?` | `{ created, updated, failed, unsupported, skipped }` | `upload_documents` |
| GET | `/api/bots/{id}/folders` | 세션 | 경로 `id` | 폴더 목록 | `list_folders` |
| POST | `/api/bots/{id}/folders` | 세션 | `{ name, parent_id? }` | 생성된 폴더 | `create_folder` |
| PATCH | `/api/bots/{id}/folders/{folderId}` | 세션 | `{ name }` | `{ ok }` | `rename_folder` |
| DELETE | `/api/bots/{id}/folders/{folderId}` | 세션 | 경로 ID | `{ ok }` | `delete_folder` (확인 필요) |

업로드 지원 형식: `txt`, `md`, `markdown`, `csv`, `json`, `xml`, `html`, `htm`, `pdf`, `docx`, `hwp`, `hwpx`, `zip`입니다. ZIP은 내부의 지원 파일을 추출합니다.

현재 문서 수정 API는 본문/제목 수정이 아니라 폴더 이동만 지원합니다. MCP용으로 `update_document(title, content)` API를 추가하는 것이 좋습니다.

## 4. Q&A 지식 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| GET | `/api/bots/{id}/qa` | 세션 | 경로 `id` | Q&A 목록 | `list_qa_pairs` |
| POST | `/api/bots/{id}/qa` | 세션 | `{ question, answer }` | 생성된 Q&A | `create_qa_pair` |
| PUT | `/api/bots/{id}/qa/{qaId}` | 세션 | `{ question?, answer? }` | 수정된 Q&A | `update_qa_pair` |
| DELETE | `/api/bots/{id}/qa/{qaId}` | 세션 | 경로 ID | `{ ok }` | `delete_qa_pair` (확인 필요) |

질문 생성·수정 시 임베딩이 함께 생성됩니다.

## 5. 채팅 및 위젯 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| POST | `/api/chat/{botId}` | 공개 | `{ message, history?, sessionId? }` | `{ reply, usedDocs?, usage }` | `chat_with_bot` |
| GET | `/api/widget/{botId}` | 공개 | 경로 `botId` | `{ title, color, greeting }` | 리소스 또는 제외 |

`history` 항목은 `{ role, content }` 구조입니다. 같은 대화를 같은 월간 세션으로 계산하려면 클라이언트가 동일한 `sessionId`를 계속 보내야 합니다.

공개 채팅 API는 현재 `botId`만 알면 호출할 수 있습니다. 외부 MCP 제공 전 허용 도메인, 호출 서명, 속도 제한 또는 별도 공개 토큰을 추가하는 것이 안전합니다.

## 6. 로그 및 분석 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| GET | `/api/bots/{id}/logs` | 세션 | `?limit=1..200` | 해당 챗봇의 최근 로그 | `list_conversations` |
| GET | `/api/analytics` | 세션 | `?days=1..365&botId=all|{id}` | KPI, 일별 추이, 의도, 거절, 도구 사용, 대화 | `get_analytics` |

분석 응답에는 `summary`, `daily`, `intents`, `refusalReasons`, `refusedConversations`, `tools`, `conversations`, `planUsage`가 포함됩니다. MCP에서는 응답 크기를 줄이기 위해 분석 영역별 도구로 나누는 것을 권장합니다.

권장 분리 도구:

- `get_overview(days, bot_id?)`
- `get_intent_analysis(days, bot_id?)`
- `get_refusal_analysis(days, bot_id?)`
- `get_tool_analytics(days, bot_id?)`
- `list_conversations(bot_id, limit?, session_id?)`

현재 `/api/bots/{id}/logs`에는 `sessionId`, 기간, 거절 여부, 의도별 필터와 페이지 커서가 없습니다. MCP 연결 전에 추가하는 것이 좋습니다.

## 7. 계정, 플랜 및 설정 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 도구 후보 |
|---|---|---|---|---|---|
| GET | `/api/tenant/plan` | 세션 | 없음 | 플랜, 구독 상태, 챗봇/월 세션 사용량 | `get_plan_usage` |
| GET | `/api/tenants/settings` | 세션 | 없음 | `{ hasKey, maskedKey }` | `get_ai_provider_status` |
| PATCH | `/api/tenants/settings` | 세션 | `{ openai_api_key }` | 키 저장/삭제 결과 | 기본 비공개 권장 |
| POST | `/api/tenants` | 서비스 키 | `{ name }` | `{ id, name, api_key }` | 내부 프로비저닝 전용 |

API 키 원문을 다루는 설정 API는 일반 MCP 도구로 노출하지 않는 것이 좋습니다.

## 8. 관리자 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 공개 |
|---|---|---|---|---|---|
| POST | `/api/admin/login` | 관리자 경로 | 현재 항상 404 | 없음 | 제외 |
| POST | `/api/admin/logout` | 관리자 | 없음 | `{ ok }` | 제외 |
| GET | `/api/admin/tenants` | 관리자 | 없음 | 테넌트 목록과 챗봇 수 | 별도 Admin MCP만 |
| POST | `/api/admin/tenants` | 관리자 | `{ name, openai_api_key? }` | 생성된 테넌트와 API 키 | 별도 Admin MCP만 |
| PATCH | `/api/admin/tenants/{id}` | 관리자 | 플랜 변경: `{ plan, subscription_status, enterprise_bot_limit?, enterprise_monthly_session_limit? }`; 일반 변경: `{ name, openai_api_key? }` | 수정 결과 | 별도 Admin MCP만 |
| DELETE | `/api/admin/tenants/{id}` | 관리자 | 경로 `id` | `{ ok }` | 제외 또는 강한 확인 필요 |

## 9. 내부 운영 및 콘텐츠 API

| 메서드 | 경로 | 인증 | 요청 | 주요 응답 | MCP 공개 |
|---|---|---|---|---|---|
| GET | `/api/cron/keepalive` | Cron 키 | 없음 | `{ ok, ts }` | 제외 |
| GET | `/api/guide` | 공개 | 없음 | HTML 문서 | MCP 리소스 후보 |

## MCP 1차 공개 권장 범위

처음에는 아래 17개 도구만 제공하는 편이 안전하고 사용하기 쉽습니다.

1. `list_bots`
2. `get_bot`
3. `create_bot`
4. `update_bot`
5. `list_documents`
6. `create_document`
7. `upload_documents`
8. `move_document`
9. `list_folders`
10. `create_folder`
11. `rename_folder`
12. `list_qa_pairs`
13. `create_qa_pair`
14. `update_qa_pair`
15. `chat_with_bot`
16. `get_analytics`
17. `get_plan_usage`

삭제 도구는 MCP 클라이언트의 명시적 사용자 확인을 요구하도록 별도 등록하는 것을 권장합니다.

## MCP 연결 전 필수 보완 사항

1. `Authorization: Bearer iai-...` 인증을 공통 인증 함수로 구현합니다.
2. API 키를 평문 DB 조회가 아니라 해시 저장 및 마지막 사용 시각 관리 방식으로 변경합니다.
3. 키별 권한 범위를 `bots:read`, `bots:write`, `docs:read`, `docs:write`, `analytics:read`, `chat:invoke`처럼 분리합니다.
4. MCP 서버가 브라우저 쿠키 없이 테넌트를 식별할 수 있도록 모든 관리 API가 Bearer 인증을 지원하게 합니다.
5. 삭제·API 키 변경·플랜 변경은 일반 MCP에서 제외하거나 사용자 확인을 강제합니다.
6. 로그 및 분석 API에 커서 페이지네이션과 세션/기간/거절/의도 필터를 추가합니다.
7. 공개 채팅에 속도 제한과 호출용 bot token 또는 서명 검증을 추가합니다.
8. 모든 MCP 변경 작업에 감사 로그와 idempotency key를 추가합니다.

권장 구조는 `MCP 서버 → IDEAL AI REST API → DB/OpenAI`입니다. MCP 서버가 DB를 직접 조회하지 않게 하면 웹 서비스와 권한·플랜 제한·감사 로직을 동일하게 유지할 수 있습니다.
