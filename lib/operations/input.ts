export class OperationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function boundedText(
  value: unknown,
  name: string,
  max: number,
  required = true,
) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  ) {
    if (!required && (value === null || value === undefined)) return "";
    throw new OperationError(`${name}을(를) 확인해주세요. (최대 ${max}자)`);
  }
  return value.trim();
}

export async function jsonBody(request: Request) {
  const maxBytes = 400_000;
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new OperationError("입력 내용이 너무 큽니다.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new OperationError("올바른 요청 형식이 아닙니다.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new OperationError("입력 내용이 너무 큽니다.", 413);
    }
    chunks.push(part.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new OperationError("올바른 요청 형식이 아닙니다.");
  }
}
