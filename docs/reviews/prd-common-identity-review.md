# 공통 신원 1단계 검수 — desk Google 로그인·검증 계정 초대 수락 (2026-10-23)

대상 PRD: [상담 담당자 로그인·고객사별 권한](../PRD-agent-login-and-customer-access.md) 5.2 초대 흐름·8장 초대 정책, L01/L02/L07/L08.
브랜치 `codex/common-identity`(기준 `b325fbe`). 인수인계 [CLAUDE-2026-10-23](../handoff/CLAUDE-2026-10-23.md) 4장의 1·2·5·6번을 다룬다. 3번(이메일 비밀번호 공통화)과 4번(에이전시 세션의 공통 사용자 ID)은 **이 PR에 없다**. 다음 PR로 분리한다.

## 구현

### Google 신원 공통 서비스 `lib/access/google.ts`

- 서버가 검증한 `account.providerAccountId`와 `profile.email_verified`만 받는다. 브라우저가 보낸 프로필은 사용하지 않는다.
- 해결 순서: 연결된 subject → 기존 tenant의 `oauth_sub` → 검증된 같은 이메일 사용자 → 신규. subject와 이메일 모두 advisory lock으로 직렬화한다.
- 미검증 같은 이메일 사용자(`verify_existing`), users 행이 없는 기존 tenant 이메일(`legacy_email`), 다른 subject가 이미 연결된 사용자(`other_google`), 비활성 사용자(`disabled`)는 거부하고 아무것도 연결하지 않는다.
- `customer-google`(desk)은 유효한 pending 초대가 있을 때만 사용자를 만들고 tenant·멤버십을 만들지 않는다(`no_invitation`). 에이전시 `google`은 신규 tenant+소유자+기본 고객사를 만든다. 같은 subject 재시도는 멱등이다.
- 실패 사유는 `GoogleIdentityError.reason`으로 로그인 화면에 짧은 코드로만 전달한다. 알려진 코드 외의 값은 일반 안내문으로 바꾼다.

### desk 호스트 OAuth 처리 `lib/customer-portal/auth-host.ts`

설치된 `next-auth/lib/env.js`의 `reqWithEnvURL`은 AUTH_URL이 있으면 모든 `/api/auth` 요청 origin을 에이전시 origin으로 바꾼다. desk에서 시작한 Google 로그인은 state/PKCE 쿠키가 desk에 남고 callback은 에이전시로 가므로 실패한다.

- `/api/auth/[...nextauth]`는 요청 Host가 **설정된 CUSTOMER_PORTAL_ORIGIN과 정확히 같을 때만** `@auth/core`의 `Auth()`를 canonical desk URL로 직접 호출한다. 그 외는 기존 next-auth handlers를 그대로 쓴다. 환경변수는 바꾸지 않았다.
- desk 설정은 공유 `authConfig`에서 `customer-google`·`customer-credentials`만 남긴다. 에이전시 `google`/`credentials`/`dev-login`은 desk에서 시작할 수 없다.
- 스킴이 AUTH_URL과 다르면(세션 쿠키 이름이 달라짐) desk 전용 처리를 하지 않는다. `trustHost`는 설정된 Host 일치 검사를 통과한 뒤에만 켠다.
- Google redirect_uri는 `CUSTOMER_PORTAL_ORIGIN/api/auth/callback/customer-google`이 된다. **Google 콘솔에 이 URI를 등록하는 것은 운영 환경 작업으로 남아 있다.**

### 초대 수락

- `PATCH /api/customer/invitations/[token]`: Origin 검사·사용자별 속도 제한 후 `acceptVerifiedInvitation`. GET은 405로 아무것도 수락하지 않는다.
- `acceptVerifiedInvitation`: customer 잠금 → 초대 `FOR UPDATE` → 로그인 사용자의 활성·이메일 검증·이메일 일치 재검사 → 고객사 활성·초대 pending·만료 재검사 → 초대자 권한 `lockAccess` 재검사 → 멤버십 upsert·초대 accepted·감사 기록. 같은 사용자의 재수락은 `duplicate: true`로 멱등이며 해제된 멤버십은 옛 초대로 복귀하지 않는다. 재초대는 이전 pending 링크를 무효화한다.
- 초대 화면 `/customer/invite/[token]`: 고객사명·초대한 파트너명·역할·마스킹된 이메일 표시. 로그인 상태에 따라 (a) 이메일 일치 → `초대 수락` 버튼, (b) 다른 계정 → 로그아웃 후 `next` 보존 로그인으로 전환, (c) 비로그인 → Google(`customer-google`, redirectTo=초대 경로)·기존 계정 로그인 링크·이메일 확인 링크 받기. 초대 토큰만으로 로그인 계정을 만들지 않는다.
- 복귀 경로 `customerReturnPath`: `/customer` 내부 경로만 허용하고 정규화 후 다시 검사한다. 단위 테스트가 WIP의 `/customer/../admin` 탈출을 잡아 수정했다. `safeNext`는 같은 함수의 별칭이다.

## 검증

- 단위 `tests/common-identity.test.ts` 4건: 복귀 경로 13개 입력, desk Host/스킴 판정, 공급자 필터·basePath 고정, 실패 코드 화이트리스트(`constructor` 등 프로토타입 키 거부).
- DB `tests/common-identity.integration.ts` 14건(격리 QA DB, 전체 롤백): 미검증 거부, 신규 가입 tenant 1개·기본 고객사·재시도 멱등, 다른 subject 거부, 초대 없는 customer-only 거부(사용자 미생성), 초대 customer-only는 사용자만 생성, 수락 멱등·감사 1건, 타인 수락 403, 회수 후 410, 재초대 시 이전 링크 410, 만료/없는 토큰 410, 미검증 사용자 403·Google 자동 병합 거부, 검증 사용자 연결, 기존 tenant subject 매핑·이메일만 일치 거부, 비활성 거부.
- HTTP `tests/customer-portal-http.integration.ts` 추가 2건: desk `/api/auth/providers`는 고객사 공급자 2개만·callback URL이 desk origin, 에이전시는 전체·desk에서 `signin/google` 시작 불가; 초대 PATCH 401/403(다른 사용자)/403(Origin 없음)/200/멱등/수락 후 상담함 200/GET 405.
- 실행 결과는 아래 "실행 기록"에 적는다.

## 실환경 미검증

- Google 콘솔 desk redirect URI 등록과 실제 Google 계정 왕복(신규·기존·초대·동일 이메일 충돌). 로컬 QA에는 Google 클라이언트가 없다.
- 이메일 발신(Resend) 설정이 없는 환경의 이메일 확인 경로는 기존대로 503이다.
- 운영 DB 이관 실행·롤백.

## 실행 기록

2026-10-23 (KST), 격리 QA 환경(Docker PostgreSQL `chatbot_qa`, 3012 프로덕션 빌드):

- 단위 `node --import tsx --test tests/*.test.ts` 125건 통과(신규 4건 포함).
- DB `PORTAL_DB_CHECK=1 … tests/common-identity.integration.ts` 14건 통과, 전체 롤백. 기존 `customer-portal.integration.ts` 31건 통과.
- 프로덕션 빌드 통과. `auth.ts → google.ts → input.ts(node:crypto)`가 Edge 미들웨어 번들에 들어가는 경고가 있어 검증 헬퍼를 `lib/customer-portal/validation.ts`로 분리해 경고 0으로 만들었다. `tsc --noEmit` 통과, 변경 파일 린트 0오류.
- HTTP: fixture 초기화 후 `tests/customer-portal-http.integration.ts` 31건 통과. 첫 실행에서 desk `/api/auth/providers`가 공급자 0개를 돌려줘 실패했는데, `Google({ id: "customer-google" })`의 커스텀 id가 요청 시점 병합 전까지 `options.id`에만 있어 필터가 기본 id만 본 것이 원인이었다. `options.id` 우선으로 고치고 단위 테스트에 같은 케이스를 추가했다.
- 브라우저(desk.localhost:3012, Google 클라이언트 없는 QA 환경이라 Google 버튼은 비표시): 비로그인 초대 화면 → `로그인한 뒤 수락` → 로그인 후 초대 경로로 복귀 → 일치 계정 안내·`초대 수락` → `/customer/qa-cafe/support` 진입. 다른 계정으로 로그인한 상태에서는 마스킹된 초대 이메일과 `다른 계정으로 로그인` 버튼만 표시되고, 누르면 로그아웃 후 초대 경로를 `next`로 보존한 로그인 화면으로 이동했다. 캡처 `docs/verification/common-identity-invite-{signed-out,matching-account,accepted-support,other-account}.jpg`. 검수에 쓴 초대·멤버십·감사 행은 삭제했다.

## 독립 리뷰 1차 (2026-10-23, Claude code-review — Codex 사용량 한도로 대체)

Codex 리뷰 봇이 "You have reached your Codex usage limits for code reviews"로 PR #4·#6·#7 모두 `failed`를 돌려줘, 한도가 풀릴 때까지 별도 리뷰 에이전트로 9건을 받았다. Codex 한도 복구 후 재요청한다.

수정(8건):

- Google 표시 이름이 80자를 넘거나 제어문자를 포함하면 로그인 자체가 실패하던 것을 `displayName`으로 정리·절단·주소 대체. 단위 검사 추가.
- `validation.ts`가 Edge 번들에 포함되므로 `Buffer.byteLength` 대신 `TextEncoder`로 바이트 길이 계산.
- 예상 밖 오류(DB 장애 등)는 `failed` 코드로 돌리되 서버 로그에 오류 이름만 남긴다(원문·행 값 미출력).
- 이미 수락한 본인이 초대 링크를 다시 열면 "사용할 수 없는 초대" 대신 "이미 수락한 초대" + 상담함 링크.
- 초대자가 권한을 잃은 초대는 수락 시 invitee에게 403을 돌리지 않고 초대를 `revoked`로 바꾸며 410으로 새 초대를 안내. DB 검사 추가(멤버십 미생성 확인).
- desk에서 에이전시 `google` 공급자를 막는 HTTP 검사가 CSRF 누락만으로 통과하던 것을 실제 CSRF 토큰으로 시작해 알 수 없는 공급자임을 확인하도록 강화.
- desk 전용 Auth 설정을 요청마다 다시 만들지 않고 base 설정별로 캐시.
- Google 버튼 노출 조건을 `googleLoginAvailable`(명시 env 또는 `AUTH_GOOGLE_*` 기본값)로 통일.

**남은 공백(미해결·제품 결정 필요)**: 이관 스크립트로 생성된 기존 에이전시 소유자의 `users.email_verified_at`은 NULL이다. PRD 8장대로 미검증 주소와 Google을 자동 병합하지 않으므로, 이 소유자가 같은 이메일로 Google 로그인하면 `verify_existing`으로 거부되는데 **에이전시 쪽 이메일 확인 흐름이 아직 없다**(고객사 비밀번호 재설정 메일은 검증을 기록하지 않는다). 기존에는 이메일만 같으면 자동 연결했으므로 L02 관점의 후퇴다. 선택지: (a) 로그인된 비밀번호 세션에서 Google 연결(계정 연결 화면), (b) 에이전시 이메일 확인 메일, (c) 이관 시 비밀번호 보유 tenant를 검증 처리(PRD 위반). 다음 PR(비밀번호 공통화·에이전시 세션 통합)에서 (a) 또는 (b)로 다룬다.

실행 기록(리뷰 반영 후): 단위 127건, DB `common-identity.integration.ts` 15건 롤백, 프로덕션 빌드(Edge 경고 0)·`tsc`·린트 통과, fixture 초기화 후 HTTP 31건 통과. 브라우저: 수락 후 같은 초대 링크를 다시 열면 "이미 수락한 초대" + 상담함 링크 표시(`docs/verification/common-identity-invite-already-accepted.jpg`). 검수 데이터는 삭제했다.

## 2단계 — 에이전시 비밀번호 공통화·세션 회수·Google 연결 (2026-10-23)

인계 4장의 3·4번과 1차 리뷰의 남은 공백(이관 소유자 Google 연결)을 다룬다. 브랜치 `codex/common-identity-2`(기준 PR #7 `e7000db`).

### 구현

- `lib/access/credentials.ts`
  - `verifyAgencyCredentials`: 이메일은 `lower(btrim)`로 찾고, 소유자 `users` 행이 있으면 **users.password_hash**로 검사한다(없을 때만 `tenants.password_hash`). 비활성 신원은 거부. 반환값에 사용자 id·`auth_version`.
  - `agencySessionValid`: 에이전시 요청마다 소유자 신원 활성·파트너 멤버십 활성·세션 `auth_version` 일치를 확인한다. users 테이블이 없거나(이관 전) users 행이 아직 없는 tenant는 통과(처음 provisioning까지 호환).
- `auth.ts`: 에이전시 `credentials`가 위 검사를 사용하고 세션 JWT에 `agency_auth_version`을 담는다. Google 에이전시 경로도 같은 값을 담는다.
- `lib/auth.ts getTenantId()` → `agencySessionValid`로 매 요청 확인. `portalUser()`의 tenant 경로도 `auth_version`을 검사한다. 고객사 비밀번호 재설정(`auth_version+1`)이 에이전시 세션도 즉시 끊는다.
- Google 연결: `googleIdentity(..., { sessionUserId })`. 미검증 같은 이메일 사용자라도 **그 사용자의 비밀번호 세션이 시작한 OAuth 흐름**이면 연결하고 `email_verified_at`을 기록한다(비밀번호 보유로 소유를 증명). 다른 세션·비로그인은 여전히 `verify_existing`. signIn 콜백은 `auth()`로 현재 세션의 공통 사용자 id를 읽는다.
- 설정 화면: Google 공급자가 있을 때 "로그인 계정" 섹션에 `Google 계정 연결` 버튼(`signIn("google", { redirectTo: "/settings?google=linked" })`), 연결 여부는 `/api/tenants/settings`의 `googleLinked`.

### 검증

- DB `tests/common-identity.integration.ts` 17건(+3): tenant 해시만 있을 때/ users 해시 우선/ 대소문자·공백 이메일/ 비활성 거부/ auth_version 불일치/ 멤버십 회수/ 세션 사용자만 Google 연결·검증 기록.
- HTTP 추가 1건: 소유자 `auth_version` 증가 → 에이전시 API 401, 복구 → 200.
- 실행 결과는 아래 실행 기록.

### 실환경 미검증

- 실제 Google 계정으로 "설정 → Google 계정 연결" 왕복(로컬 QA에 Google 클라이언트 없음). `auth()`를 Auth.js signIn 콜백 안에서 호출하는 경로는 DB 수준(`sessionUserId`)만 검증했다.
실행 기록: 단위 127건, DB common-identity 17건·portal 31건 롤백, 프로덕션 빌드(Edge 경고 0)·tsc·린트 통과, fixture 초기화 후 HTTP 32건 통과(auth_version 회수 시 포털 기반 라우트는 403, 기존 tenant 라우트는 401).

### 2단계 독립 리뷰 (2026-10-23, Claude code-review — Codex 사용량 한도로 대체)

5건 모두 반영:

- `/api/tenants/settings`의 `googleLinked` 조회가 같은 문장 안에서 `user_accounts`를 참조해 이관 전 배포에서 parse 오류로 500이 나던 것을, `to_regclass`를 JS에서 먼저 확인한 뒤에만 신원 테이블을 조회하도록 분리.
- Google 연결 세션 확인(`signedInUserId`)이 `agency_auth_version`·멤버십을 보지 않아 재설정으로 끊긴 세션도 연결을 승인할 수 있던 것을 `agencySessionValid`로 막음.
- 에이전시 이메일 조회는 정확 일치를 우선하고, 대소문자/공백만 다른 기존 중복이 있으면 정규화 일치가 **유일할 때만** 사용(임의 행 선택 방지).
- `getTenantId`를 React `cache()`로 감싸 한 요청에서 여러 번 호출돼도 신원 검사를 한 번만 수행.
- 이관 전(users 테이블 없음) 분기 단위 검사 추가(stub db). tenant 행만 있는 경우는 DB 검사에 이미 포함.
실행 기록(2단계 리뷰 반영 후): 단위 128건, DB 17건 롤백, 빌드(Edge 경고 0)·tsc·린트 통과, fixture 초기화 후 HTTP 32건 통과.
