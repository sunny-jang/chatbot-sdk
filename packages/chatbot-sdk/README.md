# IDEAL AI Chatbot SDK

웹사이트에 IDEAL AI 챗봇 위젯을 설치하는 브라우저 SDK입니다.

## 설치

```bash
npm install ideal-ai-chatbot-sdk
```

## 사용법

```ts
import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

const chatbot = await initIdealAIChatbot({
  botId: "관리자 화면의 챗봇 ID",
  botToken: "관리자 화면에서 발급된 공개 위젯 호출 토큰",
  endpoint: "https://your-ideal-ai-server.com",
});

// 페이지에서 위젯을 제거하려면
chatbot.destroy();
```

Next.js에서는 브라우저 컴포넌트의 `useEffect` 안에서 초기화하세요.

```tsx
"use client";

import { useEffect } from "react";
import { initIdealAIChatbot } from "ideal-ai-chatbot-sdk";

export function Chatbot() {
  useEffect(() => {
    let destroy: (() => void) | undefined;

    initIdealAIChatbot({
      botId: "관리자 화면의 챗봇 ID",
      botToken: "관리자 화면에서 발급된 공개 위젯 호출 토큰",
      endpoint: "https://your-ideal-ai-server.com",
    }).then((instance) => {
      destroy = instance.destroy;
    });

    return () => destroy?.();
  }, []);

  return null;
}
```

`initIdealAIChatbot`은 같은 페이지에 중복 생성된 위젯을 정리하고 하나만 유지합니다.


## 견적·상담 신청 API

관리자의 봇별 **견적·상담 신청** 화면에서 폼을 먼저 활성화하세요.

```ts
import { getIdealAIRequestSettings, submitIdealAIRequest } from "ideal-ai-chatbot-sdk";

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
