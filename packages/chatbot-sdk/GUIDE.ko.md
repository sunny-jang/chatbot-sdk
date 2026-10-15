# IDEAL AI Chatbot SDK 설치 가이드

## 1. 설치

```bash
npm install ideal-ai-widget-sdk
```

## 2. 기본 연결

```ts
import { initIdealAIChatbot } from "ideal-ai-widget-sdk";

const chatbot = await initIdealAIChatbot({
  botId: "관리자 화면의 챗봇 ID",
  botToken: "관리자 화면에서 발급된 공개 위젯 호출 토큰",
  endpoint: "https://chatbot.sdk.eunseon.com",
});
```

페이지에서 위젯을 제거하려면 `chatbot.destroy()`를 호출합니다. 같은 설정으로 다시 불러오려면 `chatbot.reload()`를 사용합니다.

## 3. React·Next.js

클라이언트 컴포넌트의 `useEffect`에서 초기화하고 정리 함수에서 위젯을 제거합니다.

```tsx
"use client";

import { useEffect } from "react";
import { initIdealAIChatbot } from "ideal-ai-widget-sdk";

export function IdealAIChatbot() {
  useEffect(() => {
    let destroy: (() => void) | undefined;
    initIdealAIChatbot({
      botId: "관리자 화면의 챗봇 ID",
      botToken: "관리자 화면에서 발급된 공개 위젯 호출 토큰",
      endpoint: "https://chatbot.sdk.eunseon.com",
    }).then((instance) => { destroy = instance.destroy; });
    return () => destroy?.();
  }, []);
  return null;
}
```

## 4. 설정값

| 항목 | 필수 | 설명 |
|---|---|---|
| `botId` | 필수 | IDEAL AI 관리자 화면에서 생성한 챗봇 ID |
| `botToken` | 필수 | IDEAL AI 관리자 화면에서 발급된 공개 위젯 호출 토큰 |
| `endpoint` | 필수 | IDEAL AI 운영 서버 주소 |
| `scriptUrl` | 선택 | 위젯 스크립트를 별도 호스팅할 때 사용 |

## 5. 운영 확인

1. 고객 사이트 우측 하단에 채팅 버튼이 표시되는지 확인합니다.
2. 테스트 메시지를 전송하고 정상 답변 여부를 확인합니다.
3. IDEAL AI 분석 대시보드에서 세션과 API 사용량이 수집되는지 확인합니다.

## 문제 해결

- 위젯이 표시되지 않으면 `botId`와 `endpoint`를 확인합니다.
- 브라우저 개발자 도구에서 `chatbot-widget.js` 요청이 200인지 확인합니다.
- Next.js 서버 컴포넌트가 아닌 클라이언트 컴포넌트에서 초기화해야 합니다.
- 같은 페이지에서 중복 초기화해도 SDK가 기존 위젯을 제거하고 하나만 유지합니다.


## 견적·상담 신청 API

관리자의 봇별 **견적·상담 신청** 화면에서 폼을 먼저 활성화하세요.

```ts
import { getIdealAIRequestSettings, submitIdealAIRequest } from "ideal-ai-widget-sdk";

const options = { endpoint: "https://your-service.example", botId: "BOT_ID", botToken: "BOT_TOKEN" };
const settings = await getIdealAIRequestSettings(options);
// settings.consentText를 고객에게 보여주고 명시적 동의를 받은 뒤 제출합니다.
const result = await submitIdealAIRequest(options, {
  kind: "quote",
  name: "고객명",
  email: "customer@example.com",
  message: "제품 견적 요청",
  consent: true,
  consentVersion: settings.consentVersion,
  idempotencyKey: crypto.randomUUID(),
});
console.log(result.receipt);
```

같은 제출을 재시도할 때는 처음 생성한 `idempotencyKey`를 유지하고, 내용을 변경하면 새 키를 만드세요. `sessionId`는 해당 봇에 이미 저장된 채팅 세션이 있을 때만 지정하세요. 개인정보 안내가 변경되면 최신 설정을 다시 조회해 동의를 받아야 합니다. 공개 API는 접수번호만 반환하며 관리자 접수 목록 조회는 로그인 후 가능합니다.

## 기존 패키지에서 이동

새 배포 패키지 이름은 `ideal-ai-widget-sdk`입니다. 기존 `ideal-ai-chatbot-sdk` 이용자는 새 패키지를 설치하고 import 경로를 바꿔주세요. 함수 이름과 직접 설치하는 위젯 스크립트 주소는 동일합니다.

## 먼저 말 걸기

설치 후 봇의 **설정 → 먼저 말 걸기**에서 활성화합니다. 별도의 클릭 추적 코드를 붙일 필요는 없습니다.

- **기본 인사**: 설정한 지연 시간 뒤 인사말을 표시합니다.
- **AI 제안**: 설치 사이트의 정확한 주소(예: `https://www.example.com`)를 등록하고 관련 문서·Q&A를 준비하세요. `www` 포함 여부와 프로토콜이 실제 사이트와 같아야 합니다.
- AI 제안은 화면에 보이는 탭에서 **누적 방문 30초 이상**(설정 지연이 더 길면 그 시간), **현재 본문 구간 누적 노출 5초 이상**이면 내용을 분석합니다. 스크롤 중에도 보이는 구간의 시간이 누적됩니다.
- 읽는 내용과 등록된 지식을 연결할 수 있으면 상황을 묻는 질문을 표시합니다. 예: “반복해서 처리하는 문서 업무가 있으신가요?”
- 질문을 만들 근거가 없거나 본문 구간이 잡히지 않으면 방문 지연 후 **“제가 도와드릴까요?”**를 표시합니다. 기본 제안은 스크롤로 구간이 바뀌어도 유지됩니다.
- 한 방문에 제안은 한 번만 표시합니다. 직접 채팅을 열거나 제안을 닫았거나 상담원 연결 중이면 반복하지 않습니다. 로그인·결제 등 제외 페이지에서는 표시하지 않습니다.
- 공개 본문의 제목·주변 내용·노출 시간을 일시적으로 참고합니다. 입력 폼의 값은 수집하지 않으며, AI 분석에는 개인정보를 걸러낸 제한된 본문 요약을 전달합니다.
- AI 분석은 모델 비용과 봇별 월 분석 한도를 사용합니다. 한 방문에 최대 2회 분석하며 관리자 **테스트 → 먼저 말 걸기 테스트**에서 새 테스트 방문으로 확인할 수 있습니다.

### 안 보일 때

설정 저장 후 페이지를 새로고침하고 위젯 버튼을 열지 않은 상태로 확인하세요. 다른 탭에 머문 시간은 제외됩니다. 이미 제안을 봤거나 닫은 방문에서는 새로고침만으로 다시 표시하지 않습니다. 등록 사이트 주소, 제외 경로, 활성화 여부와 관리자 테스트의 진단 결과를 확인하세요.

### 기존 패키지에서 이동

기존 `ideal-ai-chatbot-sdk` 대신 `ideal-ai-widget-sdk`를 설치하고 import 경로를 변경합니다. 함수 이름, 봇 ID, 공개 위젯 토큰과 서버 주소는 그대로 사용합니다. HTML 스크립트로 설치한 사이트는 npm 패키지 교체 없이 기존 스크립트 주소를 계속 사용합니다. 이 SDK는 서버의 위젯을 불러오므로 먼저 말 걸기 설정은 관리자에서 관리하며 SDK 초기화 옵션으로 전달하지 않습니다.
