/** 에이전시(공개) 사이트의 origin. 검색 엔진용 sitemap·robots가 절대 주소를 만들 때 씁니다. */
export function siteOrigin(env: Record<string, string | undefined> = process.env) {
  try {
    return new URL(env.AUTH_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}
