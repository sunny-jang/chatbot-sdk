import { egressIpLabel } from "./host";
import type { ConnectionKind } from "./types";

/** 원본 오류 메시지는 호스트·사용자 이름을 담을 수 있으므로 절대 그대로 돌려주지 않는다. 우리 문장만 쓴다. */
export function humanizeConnectionError(
  error: unknown,
  kind: ConnectionKind = "postgres",
  env?: Record<string, string | undefined>,
): string {
  const ip = egressIpLabel(env);
  const e = (error ?? {}) as { code?: unknown; errno?: unknown; message?: unknown; name?: unknown };
  const code = String(e.code ?? e.errno ?? "");
  const message = String(e.message ?? "");
  const firewall = `방화벽에서 우리 서버 IP(${ip})를 허용해주세요.`;
  if (code === "ECONNREFUSED")
    return `서버가 연결을 거부했어요. 호스트·포트를 확인하고, ${firewall}`;
  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH")
    return `서버에 닿지 못했어요(시간 초과). 호스트·포트를 확인하고, ${firewall}`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "호스트 주소를 찾지 못했어요. 주소에 오타가 없는지 확인해주세요.";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "CONNECTION_CLOSED" || code === "CONNECTION_DESTROYED")
    return "연결이 중간에 끊겼어요. SSL 설정을 확인하고 잠시 후 다시 시도해주세요.";
  if (/ssl.*not supported|does not support ssl|server does not support/i.test(message))
    return "이 서버는 SSL 연결을 받지 않아요. SSL 옵션을 끄고 다시 시도해주세요.";
  if (/(ERR_TLS|ERR_SSL|EPROTO|wrong version number|handshake)/i.test(code + " " + message))
    return "SSL 연결에 실패했어요. SSL 옵션을 바꿔 다시 시도해주세요.";
  if (kind === "postgres") {
    if (code === "28P01") return "비밀번호가 틀렸어요. 사용자 이름과 비밀번호를 다시 확인해주세요.";
    if (code === "28000") {
      if (/no encryption|ssl off|SSL off/i.test(message))
        return "SSL이 필요한 서버예요. SSL 옵션을 켜고 다시 시도해주세요.";
      return `이 사용자로는 접속이 허용되지 않아요(pg_hba). 호스팅 업체에 우리 서버 IP(${ip})와 사용자 허용을 요청해주세요.`;
    }
    if (code === "3D000") return "데이터베이스 이름을 찾지 못했어요. DB 이름을 확인해주세요.";
    if (code === "42501") return "읽기 권한이 없어요. 요청서대로 읽기 전용(SELECT) 권한을 부여해주세요.";
    if (code === "42P01") return "테이블을 찾지 못했어요. 테이블이 삭제됐거나 이름이 바뀌었는지 확인해주세요.";
    if (code === "57014") return "조회가 20초 안에 끝나지 않았어요. 테이블이 크면 필터를 좁혀주세요.";
    if (code === "53300") return "서버의 동시 접속 한도를 넘었어요. 잠시 후 다시 시도해주세요.";
    if (code === "25006") return "쓰기 요청이 막혔어요. 읽기 전용 세션에서는 조회만 할 수 있어요.";
  }
  if (kind === "mysql") {
    if (code === "ER_ACCESS_DENIED_ERROR" || code === "ER_ACCESS_DENIED_NO_PASSWORD_ERROR")
      return "비밀번호가 틀렸어요. 사용자 이름과 비밀번호를 다시 확인해주세요.";
    if (code === "ER_HOST_NOT_PRIVILEGED" || code === "ER_HOST_IS_BLOCKED")
      return `이 서버에서 우리 IP의 접속을 허용하지 않아요. 호스팅 업체에 우리 서버 IP(${ip}) 허용을 요청해주세요.`;
    if (code === "ER_BAD_DB_ERROR") return "데이터베이스 이름을 찾지 못했어요. DB 이름을 확인해주세요.";
    if (code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_TABLEACCESS_DENIED_ERROR")
      return "읽기 권한이 없어요. 요청서대로 읽기 전용(SELECT) 권한을 부여해주세요.";
    if (code === "ER_NO_SUCH_TABLE") return "테이블을 찾지 못했어요. 테이블이 삭제됐거나 이름이 바뀌었는지 확인해주세요.";
    if (code === "ER_QUERY_TIMEOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT")
      return "조회가 20초 안에 끝나지 않았어요. 테이블이 크면 필터를 좁혀주세요.";
    if (code === "HANDSHAKE_NO_SSL_SUPPORT")
      return "이 서버는 SSL 연결을 받지 않아요. SSL 옵션을 끄고 다시 시도해주세요.";
  }
  return "연결하지 못했어요. 호스트·포트·DB 이름·SSL 설정을 확인해주세요.";
}
