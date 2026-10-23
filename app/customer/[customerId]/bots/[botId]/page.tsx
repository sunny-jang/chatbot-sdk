import sql from "@/lib/neon";
import { customerPageAccess } from "@/lib/customer-portal/page";
import { customerBot } from "@/lib/customer-portal/bots";
import { notFound } from "next/navigation";
import BotWorkspace from "./BotWorkspace";
export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string; botId: string }>;
}) {
  const p = await params,
    { user } = await customerPageAccess(p.customerId, "bot.read");
  let bot;
  try {
    bot = (await customerBot(sql, user.id, p.customerId, p.botId)).bot;
  } catch {
    notFound();
  }
  return (
    <BotWorkspace
      key={`${user.id}:${p.customerId}:${p.botId}`}
      customerId={p.customerId}
      bot={JSON.parse(JSON.stringify(bot))}
      endpoint={process.env.AUTH_URL || ""}
    />
  );
}
