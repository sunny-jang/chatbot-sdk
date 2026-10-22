import { createHash, randomBytes } from "node:crypto";
import { PortalError } from "./validation";
export { PortalError, text, email, website, password } from "./validation";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export { customerReturnPath as safeNext } from "./return-path";
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const configured = process.env.CUSTOMER_PORTAL_ORIGIN;
  const portalOrigin = configured ? new URL(configured).origin : null;
  const isPortalRequest =
    portalOrigin &&
    req.headers.get("host")?.toLowerCase() ===
      new URL(portalOrigin).host.toLowerCase();
  const expected = isPortalRequest ? portalOrigin : new URL(req.url).origin;
  if (!origin || origin !== expected)
    throw new PortalError("요청 출처를 확인해주세요.", 403);
}
export async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new PortalError("입력 내용을 확인해주세요.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > 12000) {
      await reader.cancel();
      throw new PortalError("요청이 너무 큽니다.", 413);
    }
    chunks.push(part.value);
  }
  try {
    const x = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!x || typeof x !== "object" || Array.isArray(x)) throw Error();
    return x as Record<string, unknown>;
  } catch {
    throw new PortalError("입력 내용을 확인해주세요.");
  }
}
export function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof PortalError
          ? error.message
          : "처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    { status: error instanceof PortalError ? error.status : 500 },
  );
}
