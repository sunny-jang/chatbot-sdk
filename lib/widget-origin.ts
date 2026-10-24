import sql from "@/lib/neon";

/**
 * 위젯이 호출하는 공개 API(/api/chat/*, /api/widget/*)의 출처 제한.
 * 봇이 연결된 고객사에 홈페이지 주소가 등록돼 있으면 그 도메인(과 우리 자체 호스트)에서만 허용하고,
 * 주소가 없으면 예전처럼 모든 출처를 허용합니다. 브라우저가 아닌 호출(Origin 헤더 없음)은 막지 않습니다.
 */
export function hostKey(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
export function ownOrigins(env: Record<string, string | undefined> = process.env) {
  return [env.AUTH_URL, env.CUSTOMER_PORTAL_ORIGIN, env.MASTER_ORIGIN]
    .map(hostKey)
    .filter((h): h is string => !!h);
}
export function widgetOriginAllowed(
  origin: string | null,
  website: string | null,
  own: string[] = ownOrigins(),
) {
  // 서버 간 호출·같은 출처 요청에는 Origin이 없습니다.
  if (!origin || origin === "null") return true;
  const site = hostKey(website);
  if (!site) return true;
  const host = hostKey(origin);
  if (!host) return false;
  if (host === site || own.includes(host)) return true;
  // 개발 중 임의 로컬 포트에서 테스트할 수 있게, 운영이 아닐 때만 localhost를 열어둡니다.
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1")
    return process.env.NODE_ENV !== "production";
  return false;
}

type Cached = { website: string | null; at: number };
const cache = new Map<string, Cached>();
const TTL = 60_000;
export async function botWebsite(botId: string) {
  const hit = cache.get(botId);
  if (hit && Date.now() - hit.at < TTL) return hit.website;
  let website: string | null = null;
  try {
    const rows = await sql<{ website: string | null }[]>`
      SELECT c.website FROM bots b LEFT JOIN customers c ON c.id=b.customer_id WHERE b.id=${botId}`;
    website = rows[0]?.website ?? null;
  } catch {
    website = null;
  }
  cache.set(botId, { website, at: Date.now() });
  return website;
}
/** 설정 변경 직후 반영되도록 캐시를 비웁니다. */
export function forgetBotWebsite(botId?: string) {
  if (botId) cache.delete(botId);
  else cache.clear();
}

type Ctx = { params: Promise<{ botId: string }> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response> | Response;
function withOrigin(res: Response, origin: string | null) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Bot-Token");
  headers.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
/** 라우트 핸들러를 감싸 출처를 검사하고 응답에 CORS 헤더를 붙입니다. 스트리밍 응답도 그대로 통과합니다. */
export function withWidgetCors(handler: Handler): Handler {
  return async (req, ctx) => {
    const { botId } = await ctx.params;
    const origin = req.headers.get("origin");
    const website = await botWebsite(botId);
    // 허용되지 않은 출처에는 CORS 헤더를 붙이지 않아 브라우저가 응답 자체를 읽지 못하게 합니다.
    if (!widgetOriginAllowed(origin, website))
      return Response.json(
        { error: "이 챗봇은 등록된 홈페이지 주소에서만 사용할 수 있습니다.", code: "ORIGIN_NOT_ALLOWED" },
        { status: 403 },
      );
    return withOrigin(await handler(req, ctx), origin);
  };
}
