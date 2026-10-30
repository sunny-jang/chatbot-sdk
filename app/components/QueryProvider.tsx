"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * 화면 안에서 불러오는 목록·설정을 캐시한다. 한 번 불러온 화면은 다시 열 때 바로 보이고, 뒤에서 새로 고친다.
 * 레이아웃이 로그인한 사람 기준 `key`로 감싸므로 계정이 바뀌면 캐시도 새로 시작한다.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30초 안에 다시 열면 요청 없이 캐시를 쓰고, 그 뒤에는 캐시를 먼저 보여주고 새로 고친다.
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
