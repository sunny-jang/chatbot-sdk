import sql from "@/lib/neon";
import { readPublicDemo } from "@/lib/demo/store";
import { demoBackgroundVersion } from "@/lib/demo/backgrounds";
import DemoSite from "./DemoSite";
import "./site-demo.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "고객사 챗봇 데모",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let demo;
  try {
    demo = await readPublicDemo(sql, token);
  } catch {
    return (
      <main className="site-demo-unavailable">
        <h1>사용할 수 없는 데모 링크입니다</h1>
        <p>
          링크가 만료되었거나 해제되었습니다. 안내받은 에이전시에 새 링크를
          요청해주세요.
        </p>
      </main>
    );
  }
  const backgroundVersion = await demoBackgroundVersion(sql, demo.id);
  return (
    <DemoSite
      token={token}
      botId={demo.bot_id}
      siteUrl={demo.site_url}
      customerName={demo.customer_name}
      botName={demo.bot_name}
      expiresAt={Number(demo.expires_at)}
      backgroundUrl={
        backgroundVersion
          ? `/api/demo/${token}/background?v=${backgroundVersion}`
          : null
      }
    />
  );
}
