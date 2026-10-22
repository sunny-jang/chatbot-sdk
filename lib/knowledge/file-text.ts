import mammoth from "mammoth";
export function getExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractText(
  filename: string,
  buffer: ArrayBuffer,
): Promise<string> {
  const ext = getExtension(filename);
  if (ext === ".pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/\x00/g, "").trim();
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    return result.value.trim();
  }
  if (ext === ".hwp" || ext === ".hwpx") {
    const { toMarkdown } = await import("@mdgate/hwp");
    try {
      return (
        await toMarkdown(new Uint8Array(buffer), { path: filename })
      ).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("encrypted") || message.includes("password")) {
        throw new Error(
          "암호화되거나 배포용으로 잠긴 HWP 문서는 업로드할 수 없습니다.",
        );
      }
      throw new Error(
        "HWP 문서 본문을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.",
      );
    }
  }
  if (ext === ".html" || ext === ".htm") {
    return stripHtml(new TextDecoder().decode(buffer));
  }
  return new TextDecoder().decode(buffer).trim();
}
