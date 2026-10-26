import { readDbSources, manageDbSources } from "@/lib/db-sources/handlers";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export const GET = (req: Request, ctx: Context) => readDbSources(req, ctx);
export const POST = (req: Request, ctx: Context) => manageDbSources(req, ctx);
