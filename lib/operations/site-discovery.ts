import { load } from "cheerio";
import { OperationError } from "./input";
import {
  fetchPublicHtml,
  fetchPublicXml,
  normalizeWebUrl,
} from "./web-fetch";

/** 한 번에 제안하는 페이지 수 상한. 사이트맵이 더 커도 여기까지만 보여줍니다. */
export const DISCOVER_LIMIT = 300;
const MAX_SITEMAPS = 10;
const SKIP_EXT =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|gz|mp4|mp3|woff2?|ttf|eot)$/i;

function sameHostUrl(raw: string, base: URL): URL | null {
  if (/^(mailto|tel|javascript):/i.test(raw.trim())) return null;
  try {
    const url = normalizeWebUrl(new URL(raw.trim(), base).toString());
    return url.hostname === base.hostname ? url : null;
  } catch {
    return null;
  }
}
/** 문서로 저장할 페이지 주소만 남깁니다 (파일·이미지 등 제외). */
function pageUrl(raw: string, base: URL): string | null {
  const url = sameHostUrl(raw, base);
  if (!url || SKIP_EXT.test(url.pathname)) return null;
  return url.toString();
}

/** 사이트맵 XML에서 하위 사이트맵과 페이지 주소를 뽑습니다. (같은 호스트, 페이지 파일만) */
export function sitemapEntries(body: string, base: URL) {
  const $ = load(body, { xml: true });
  const children = $("sitemapindex > sitemap > loc")
    .map((_, el) => sameHostUrl($(el).text(), base)?.toString() ?? null)
    .get()
    .filter((u): u is string => !!u);
  const pages = $("urlset > url > loc")
    .map((_, el) => pageUrl($(el).text(), base))
    .get()
    .filter((u): u is string => !!u);
  return { children, pages };
}

async function readSitemap(
  url: string,
  base: URL,
  pages: Set<string>,
  visited: Set<string>,
) {
  if (visited.size >= MAX_SITEMAPS || visited.has(url)) return;
  visited.add(url);
  let body: string;
  try {
    body = (await fetchPublicXml(url)).body;
  } catch {
    return;
  }
  const entries = sitemapEntries(body, base);
  for (const child of entries.children) {
    if (pages.size >= DISCOVER_LIMIT) return;
    await readSitemap(child, base, pages, visited);
  }
  for (const page of entries.pages) {
    if (pages.size >= DISCOVER_LIMIT) return;
    pages.add(page);
  }
}

/**
 * 사이트 주소를 받아 robots.txt의 Sitemap, /sitemap.xml 순으로 페이지 목록을 모읍니다.
 * 사이트맵이 없으면 시작 페이지의 같은 호스트 링크로 대신합니다.
 */
export async function discoverSitePages(input: string) {
  const start = normalizeWebUrl(input);
  const pages = new Set<string>();
  const visited = new Set<string>();
  const first = await fetchPublicHtml(start.toString());
  const base = new URL(first.finalUrl);
  const candidates = [
    ...first.sitemaps,
    new URL("/sitemap.xml", base).toString(),
    new URL("/sitemap_index.xml", base).toString(),
  ];
  for (const candidate of candidates) {
    const url = sameHostUrl(candidate, base);
    if (url) await readSitemap(url.toString(), base, pages, visited);
    if (pages.size >= DISCOVER_LIMIT) break;
  }
  let via: "sitemap" | "links" = "sitemap";
  if (!pages.size) {
    via = "links";
    const $ = load(first.body);
    pages.add(base.toString());
    $("a[href]").each((_, el) => {
      if (pages.size >= DISCOVER_LIMIT) return false;
      const page = pageUrl(String($(el).attr("href")), base);
      if (page) pages.add(page);
    });
  }
  if (!pages.size) throw new OperationError("sitemap 검색결과가 없습니다.");
  return { via, pages: [...pages], startUrl: base.toString() };
}
