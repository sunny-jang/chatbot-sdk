# IDEAL AI Chatbot SDK 설치 가이드

## 1. 설치

```bash
npm install ideal-ai-chatbot-sdk
```

## 2. 기본 연결

```ts
import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

const chatbot = await initIdealAIChatbot({
  botId: "관리자 화면의 챗봇 ID",
  endpoint: "https://chatbot.sdk.eunseon.com",
});
```

페이지에서 위젯을 제거하려면 `chatbot.destroy()`를 호출합니다. 같은 설정으로 다시 불러오려면 `chatbot.reload()`를 사용합니다.

## 3. React·Next.js

클라이언트 컴포넌트의 `useEffect`에서 초기화하고 정리 함수에서 위젯을 제거합니다.

```tsx
"use client";

import { useEffect } from "react";
import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

export function IdealAIChatbot() {
  useEffect(() => {
    let destroy: (() => void) | undefined;
    initIdealAIChatbot({
      botId: "관리자 화면의 챗봇 ID",
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
