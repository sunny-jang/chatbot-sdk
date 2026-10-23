import { request } from "node:http";
export async function localFetch(url: string, init: RequestInit = {}) {
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      { method: init.method, headers: init.headers as Record<string, string> },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            for (const item of Array.isArray(value)
              ? value
              : value === undefined
                ? []
                : [value])
              headers.append(key, item);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(init.body == null ? undefined : String(init.body));
  });
}
export const base = "http://127.0.0.1:3012",
  desk = "desk.localhost:3012",
  agency = "localhost:3012";
type Login = { email: string; password: string };
export async function api(
  path: string,
  host: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const r = await localFetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      Host: host,
      Origin: "http://" + host,
      Cookie: cookie,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return {
    status: r.status,
    data,
    location: r.headers.get("location"),
    headers: r.headers,
  };
}
export async function login(
  account: Login,
  host: string,
  provider = "customer-credentials",
) {
  let cookie = "";
  const jar = new Map<string, string>();
  const collect = (r: { headers: Headers }) => {
    for (const raw of r.headers.getSetCookie()) {
      const c = raw.split(";")[0];
      jar.set(c.slice(0, c.indexOf("=")), c);
    }
    cookie = [...jar.values()].join("; ");
  };
  collect(await api("/api/auth/csrf", host));
  const csrf = await api("/api/auth/csrf", host, cookie);
  collect(csrf);
  const r = await localFetch(base + "/api/auth/callback/" + provider, {
    method: "POST",
    redirect: "manual",
    headers: {
      Host: host,
      Origin: "http://" + host,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      csrfToken: csrf.data.csrfToken,
      ...account,
      callbackUrl: "http://" + host + "/customer",
    }),
  });
  collect(r);
  return cookie;
}
