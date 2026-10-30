"use client";
import { useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";

/** API 응답의 error 문구를 그대로 사용자에게 보여줄 수 있게 Error로 바꾼다. */
export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" });
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  if (!r.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
    throw new Error(message);
  }
  return data as T;
}

/**
 * GET 한 번을 캐시하는 공통 훅. key는 화면·대상 id를 포함해야 한다(예: ["customer", id, "members"]).
 * 처음 열 때만 isPending이 true이고, 캐시가 있으면 data가 바로 채워진 채로 뒤에서 새로 고친다.
 */
export function useApiQuery<T>(
  key: QueryKey,
  url: string | null,
  options: Omit<UseQueryOptions<T, Error, T, QueryKey>, "queryKey" | "queryFn"> = {},
) {
  return useQuery<T, Error, T, QueryKey>({
    queryKey: key,
    queryFn: ({ signal }) => apiGet<T>(url as string, signal),
    enabled: url !== null && (options.enabled ?? true),
    ...options,
  });
}

/** 저장·삭제 뒤 해당 화면 캐시를 새로 고친다. 접두사 key로 하위 key까지 함께 무효화된다. */
export function useInvalidate() {
  const client = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
