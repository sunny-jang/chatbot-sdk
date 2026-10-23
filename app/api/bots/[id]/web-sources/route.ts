import { readWebSources, manageWebSources } from "@/lib/operations/web-sources";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Context) => readWebSources(req, ctx);
export const POST = (req: Request, ctx: Context) => manageWebSources(req, ctx);
