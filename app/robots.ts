import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isCustomerPortalHost } from "@/lib/customer-portal/host";
import { isMasterHost } from "@/lib/master-host";
import { siteOrigin } from "@/lib/site-origin";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  // 고객사 데스크·마스터 콘솔 호스트는 통째로 색인 금지.
  if (isCustomerPortalHost(host) || isMasterHost(host))
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 로그인 뒤 화면과 API, 공유 토큰이 들어가는 데모 링크는 검색에 나오지 않게 합니다.
      disallow: [
        "/api/",
        "/admin",
        "/analytics",
        "/bots",
        "/customers",
        "/customer/",
        "/demos",
        "/demo/",
        "/guide",
        "/requests",
        "/sdk-guide",
        "/settings",
        "/support",
      ],
    },
    sitemap: siteOrigin() + "/sitemap.xml",
  };
}
