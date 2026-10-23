# 고객사 포털·초대·데모 화면 디자인 통일 (2026-10-23)

## 배경

에이전시 화면은 PR #1(워크스페이스 개편, `app/globals.css`의 `.workspace-*`)과 Tailwind 토큰을 쓰는데, 고객사 포털(desk)·초대·고객사 관리·데모 화면은 별도 `app/customer/portal.css`(청록 `#155e75`/네이비 `#213847`)와 `site-demo.css`(보라)로 만들어져 같은 제품 안에 디자인 시스템이 둘이었다. 사용자 결정: **메인 디자인으로 전부 통일, 단 desk 로그인의 2분할 레이아웃은 유지.**

## 방법

- 19개 컴포넌트가 쓰는 `cp-*` 선택자를 그대로 두고 `portal.css`를 메인 토큰으로 다시 썼다. 마크업 변경은 desk 로그인 워드마크에 공용 로고 이미지(`/logo.png`)를 넣은 것뿐이다.
- 토큰(`.workspace-*`와 동일): 본문 `#17243b`, 보조 `#59677d`, 테두리 `#dce3ee`/`#e4e9f1`, 페이지 배경 `#f3f6fb`, 기본 버튼 `#4059d8`(hover `#2946c7`), 선택 탭 `#eef2fa`/`#4059a0`, 패널 12px·컨트롤 8px 라운드, 포커스 링 `#4059d8`. CSS 변수 `--cp-*`로 정의.
- desk 로그인: 좌우 2분할 유지, 오른쪽 패널은 `.analytics-hero`와 같은 네이비 그라데이션.
- 데모 페이지 `site-demo.css`도 같은 토큰으로 교체(보라 → 인디고).

## 확인

빌드 후 브라우저 캡처 `docs/verification/design-unify-*.jpg`: desk 로그인 전/후, 초대 화면, 포털 상담함, 챗봇 관리(설정 탭), 데모 페이지. `tsc`·린트 통과. 기능 변경 없음(CSS + 로고 이미지).

## 남은 것

- 에이전시 로그인(`/login`)은 중앙 카드 레이아웃 그대로다. desk처럼 2분할로 바꿀지는 별도 결정.
- `app/customers/*`(에이전시 쪽 고객사 관리)도 `cp-*`를 쓰므로 이번 토큰 변경이 함께 적용된다.

## 2차 — "솔루션 업체" 수준으로 전체 톤 정리 (2026-10-23)

사용자 피드백: 통일은 됐지만 전반적으로 가벼워 보인다. 실제 B2B 솔루션처럼 보이게 한다.

**설계 메모**
- 대상: 웹에이전시 운영자(매일)·소규모 사업장 담당자(가끔). 할 일: 오늘 기다리는 고객부터 응대.
- 팔레트(6): 본문 `#141a24`, 보조 `#5c6675`, 선 `#e2e6ec`, 캔버스 `#f4f5f8`, 표면 `#fff`, 브랜드 `#2e55d1`(hover `#2446b1`). 로그인 소개 패널만 네이비 `#0f1a33`. 상태색은 대기/진행/종료 3종.
- 타입: Pretendard Variable 한 가족(한글 우선, jsdelivr CSS). 본문 13.5–14px, 페이지 제목 22px, 패널 제목 15px, 자간 -0.01em, 숫자 tabular, `word-break: keep-all`.
- 레이아웃: 232px 사이드바 + 18px 스트로크 SVG 아이콘(이모지 글리프 제거), 활성 항목은 좌측 3px 인디케이터, 콘텐츠 최대 1240px. 지표는 카드 묶음이 아닌 한 줄 스트립, 패널 10px·컨트롤 7px·칩 5px로 라운드 차등. 그림자는 띄우는 요소에만.
- 한 곳에만 힘주기: 로그인 오른쪽 패널(`LoginShowcase`) — 제품 문장 + 상담함 정지 화면(실제 Q&A·대기 칩). 에이전시/desk 로그인이 같은 2분할 구조를 공유한다. 나머지는 조용하게.
- 카피: 지표 액션 "확인하기" → "대기 상담 열기/진행 상담 보기/접수 내역 보기/챗봇 관리". 로그아웃 문 이모지 제거.

**변경 파일**: `app/globals.css`(토큰 `:root` + `.workspace-*`·`.inbox-*`·`.auth-*` 재작성), `app/layout.tsx`(Pretendard), `app/Sidebar.tsx` + `app/components/NavIcon.tsx`, `app/components/LoginShowcase.tsx`, `app/login/page.tsx`, `app/customer/login/LoginClient.tsx`, `app/LogoutButton.tsx`, `app/page.tsx`(카피), `app/customer/portal.css`(토큰 참조).

**확인**: 캡처 `docs/verification/design-pro-*.jpg`(에이전시 로그인, desk 로그인, 업무 홈, 상담함, 고객사 관리, 모바일 desk 로그인). 빌드·tsc·린트 통과. HTTP 검사의 desk 로그인 문구 단언을 새 제목("상담함 로그인")으로 갱신.

**남은 것**: 로그인 상태에서 `/login`을 열면 사이드바 레이아웃 안에 로그인 폼이 렌더되는 기존 동작(리디렉션 없음)은 그대로다. `/analytics` 등 `.analytics-*` 화면은 자체 팔레트(보라 `#6655e8`)를 유지하고 있어 다음 단계에서 같은 토큰으로 맞춘다.

## 데이터 경계 — 에이전시 분석에서 고객사 대화 원문 제외 (2026-10-23)

사용자 결정: 고객사에 배정된 챗봇의 대화는 고객사 데이터다. 에이전시는 **집계 수치만** 본다. 예외는 자기 사업장(기본 고객사 `우리 회사`) 봇과 미배정 봇.

- `lib/access/visibility.ts` `restrictedBotIds(tenant)`: `customers.is_default=FALSE`인 고객사에 배정된 봇 집합. customers 테이블이 없으면(이관 전) 제한 없음.
- `/api/analytics`: summary·daily·intents·refusalReasons·tools는 모든 봇을 집계하되 `conversations`·`refusedConversations`는 제한 봇을 제외. 응답에 `restricted{bots,selected,hiddenMessages,notice}`를 추가하고 대시보드 상단에 안내 배너. 제한 봇 하나를 선택하면 `selected: true`와 함께 집계만.
- `/api/bots/[id]/logs` → 제한 봇은 403, `/bots/[id]/logs` 페이지는 안내 패널. `/api/bots/[id]/qa-analytics`의 `unmatched` 질문 원문은 제한 봇에서 빈 배열(`restricted: true`).
- desk의 고객사 관리자 경로(`/api/customer/[customerId]/bots/[botId]/logs`)는 그대로 원문 제공.
- PRD 권한표에 "대화 원문 분석·대화 기록·세션 상세: 자사·미배정 봇만" 행과 결정 메모 추가.
- 검증: DB 1건(배정/자사/미배정 구분), HTTP 1건(원문 제외·집계 포함·단일 봇 selected·logs 403/200·페이지 안내·desk 원문 유지).

**후속 결정 필요**: `/api/bots/[id]/unanswered`(미응답 보완)와 `/api/bots/[id]/requests`(문의 원문)는 지식 유지·접수 처리 업무라 이번 제한에 넣지 않았다. 같은 경계를 적용할지 결정이 필요하다.
