import robotsParser from "robots-parser";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { OperationError } from "./input";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    // Only global unicast. Reject mapped, NAT64, local, multicast and transition ranges.
    return (
      /^[23][0-9a-f]{3}:/.test(normalized) &&
      !normalized.startsWith("2001:") &&
      !normalized.startsWith("2002:") &&
      !normalized.startsWith("3fff:")
    );
  }
  return false;
}
export function normalizeWebUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OperationError("올바른 URL을 입력해주세요.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new OperationError("공개 HTTP/HTTPS 주소만 지원합니다.");
  url.hash = "";
  return url;
}
function download(
  url: URL,
  address: string,
  family: number,
  signal: AbortSignal,
): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        signal,
        family,
        autoSelectFamily: false,
        headers: {
          "User-Agent": "IdealAI-KnowledgeImporter/1.0",
          Accept: "text/html",
          "Accept-Encoding": "identity",
        },
        lookup: (_host, _options, callback) => callback(null, address, family),
      } as http.RequestOptions & { autoSelectFamily: boolean },
      (response) => {
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({
            status,
            location: response.headers.location,
            type: "",
            body: "",
          });
          return;
        }
        const type = String(response.headers["content-type"] || "");
        if (Number(response.headers["content-length"] || 0) > 2_000_000) {
          response.destroy();
          reject(new OperationError("페이지가 2MB 제한을 초과합니다."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            response.destroy();
            reject(new OperationError("페이지가 2MB 제한을 초과합니다."));
          } else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status,
            type,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}
export async function fetchPublicHtml(input: string) {
  const signal = AbortSignal.timeout(15000);
  let url = normalizeWebUrl(input);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await lookup(host, { all: true });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new OperationError("내부 또는 제한된 주소는 가져올 수 없습니다.");
      const address = addresses.find((a) => a.family === 4) || addresses[0];
      const robotsUrl = new URL("/robots.txt", url);
      const robots = await download(
        robotsUrl,
        address.address,
        address.family,
        signal,
      );
      if (
        robots.status === 200 &&
        robotsParser(robotsUrl.toString(), robots.body).isAllowed(
          url.toString(),
          "IdealAI-KnowledgeImporter",
        ) === false
      )
        throw new OperationError(
          "사이트의 robots 정책에서 수집을 허용하지 않습니다.",
        );
      if (
        robots.status !== 200 &&
        robots.status !== 404 &&
        robots.status !== 410
      )
        throw new OperationError("사이트의 수집 정책을 확인할 수 없습니다.");
      const result = await download(
        url,
        address.address,
        address.family,
        signal,
      );
      if (result.status >= 300 && result.status < 400) {
        if (!result.location || redirect === 3)
          throw new OperationError("리디렉션이 너무 많거나 올바르지 않습니다.");
        url = normalizeWebUrl(new URL(result.location, url).toString());
        continue;
      }
      if (result.status !== 200)
        throw new OperationError(
          `페이지를 가져오지 못했습니다. (HTTP ${result.status})`,
        );
      if (!/text\/html|application\/xhtml\+xml/i.test(result.type))
        throw new OperationError(
          "HTML 웹페이지만 지원합니다. 파일은 문서 업로드를 이용해주세요.",
        );
      return { html: result.body, finalUrl: url.toString() };
    }
  } catch (e) {
    if (e instanceof OperationError) throw e;
    throw new OperationError(
      "페이지 연결에 실패했거나 15초 제한을 초과했습니다.",
    );
  }
  throw new OperationError("페이지를 가져오지 못했습니다.");
}
export const contentHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
