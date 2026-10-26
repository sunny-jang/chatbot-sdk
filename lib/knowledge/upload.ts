import { PortalError } from "../customer-portal/input";
/** Enforce the limit while reading, even when Content-Length is absent. */
export async function uploadForm(req: Request, maxBytes = 6 * 1024 * 1024) {
  const reader = req.body?.getReader();
  if (!reader) throw new PortalError("파일을 선택해주세요.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PortalError(
        "업로드는 5MB 이하 파일만 사용할 수 있습니다.",
        413,
      );
    }
    parts.push(next.value);
  }
  try {
    return await new Response(Buffer.concat(parts), {
      headers: { "Content-Type": req.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new PortalError("파일 형식을 확인해주세요.");
  }
}
