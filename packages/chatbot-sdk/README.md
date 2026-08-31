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
