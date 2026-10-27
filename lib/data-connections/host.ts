import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { publicAddress } from "@/lib/operations/web-fetch";
import { PortalError } from "@/lib/customer-portal/validation";

export const PORT_MIN = 1024,
  PORT_MAX = 65535;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function connectionPort(value: unknown): number {
  const port = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isInteger(port) || (port as number) < PORT_MIN || (port as number) > PORT_MAX)
    throw new PortalError(`포트는 ${PORT_MIN}~${PORT_MAX} 사이 숫자로 입력해주세요.`);
  return port as number;
}

/** 소문자·공백 제거한 호스트. 형식만 보고, 공개 주소 여부는 resolveConnectionHost에서 본다. */
export function connectionHostname(value: unknown): string {
  const host = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) throw new PortalError("호스트 주소를 입력해주세요.");
  if (/[\s/@:?#]/.test(host) && isIP(host) !== 6)
    throw new PortalError("호스트는 도메인 또는 IP 주소만 입력해주세요. (프로토콜·포트·경로 제외)");
  if (!isIP(host) && !HOSTNAME.test(host))
    throw new PortalError("호스트 주소 형식을 확인해주세요.");
  return host;
}

/** QA 전용. 정확히 일치하는 호스트만 공개 주소 검사에서 제외한다. 운영 env에는 두지 않는다. */
export function hostAllowList(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.DATA_CONNECTION_ALLOW_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const PRIVATE_HOST_MESSAGE =
  "내부 또는 제한된 주소로는 연결할 수 없어요. 공개 주소(도메인 또는 공인 IP)를 입력하고, 방화벽에서 우리 서버 IP를 허용해주세요.";

/** 주어진 주소 목록이 모두 공개 주소인지. 허용 목록의 호스트는 통과. */
export function addressesAllowed(
  host: string,
  addresses: string[],
  allow: Set<string> = hostAllowList(),
): boolean {
  if (allow.has(host)) return true;
  if (!addresses.length) return false;
  return addresses.every((a) => publicAddress(a));
}

/** DNS를 풀어 공개 주소를 확인하고 연결에 쓸 주소 하나를 고른다. */
export async function resolveConnectionHost(
  host: string,
): Promise<{ address: string; family: 4 | 6 }> {
  const allow = hostAllowList();
  let addresses: { address: string; family: number }[];
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }];
  else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new PortalError("호스트 주소를 찾지 못했어요. 주소에 오타가 없는지 확인해주세요.");
    }
  }
  if (!addressesAllowed(host, addresses.map((a) => a.address), allow))
    throw new PortalError(PRIVATE_HOST_MESSAGE);
  const picked = addresses.find((a) => a.family === 4) ?? addresses[0];
  return { address: picked.address, family: picked.family === 6 ? 6 : 4 };
}

export function egressIps(env: Record<string, string | undefined> = process.env): string[] {
  return (env.DATA_CONNECTION_EGRESS_IPS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
export function egressIpLabel(env?: Record<string, string | undefined>) {
  const ips = egressIps(env);
  return ips.length ? ips.join(", ") : "배포 후 안내";
}
