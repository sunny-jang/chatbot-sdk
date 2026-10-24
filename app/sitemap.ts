import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

// 로그인 없이 볼 수 있는 소개 페이지만 싣습니다. 워크스페이스·고객사 데스크·마스터 콘솔은 검색 대상이 아닙니다.
const PUBLIC_PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" }[] = [
  { path: "/brochure.html", priority: 1, changeFrequency: "monthly" },
  { path: "/plan", priority: 0.8, changeFrequency: "monthly" },
  { path: "/demo", priority: 0.7, changeFrequency: "monthly" },
  { path: "/signup", priority: 0.5, changeFrequency: "monthly" },
  { path: "/login", priority: 0.3, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const lastModified = new Date();
  return PUBLIC_PAGES.map(({ path, priority, changeFrequency }) => ({
    url: origin + path,
    lastModified,
    priority,
    changeFrequency,
  }));
}
