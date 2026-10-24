import { Auth, setEnvDefaults, type AuthConfig } from "@auth/core";
import { NextRequest } from "next/server";
import { isCustomerPortalHost } from "./host";
import { isMasterHost } from "../master-host";

/** Only the customer-portal providers may start or complete a login on the desk host. */
export const CUSTOMER_PORTAL_PROVIDERS = [
  "customer-google",
  "customer-credentials",
] as const;

/**
 * next-auth rewrites every /api/auth request to AUTH_URL, so a Google login started on the
 * desk host would send its state/PKCE cookies to the agency origin and fail. Requests whose
 * Host is exactly CUSTOMER_PORTAL_ORIGIN are handled here against the canonical desk URL
 * instead, so cookies, redirect_uri and the callback all stay on the desk host.
 */
export const MASTER_PROVIDERS = ["google", "credentials"] as const;

/** Which dedicated host (if any) this request belongs to; each keeps its own provider set. */
export function dedicatedAuthHost(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): { origin: URL; providers: readonly string[] } | null {
  const desk = customerPortalAuthOrigin(req, env);
  if (desk) return { origin: desk, providers: CUSTOMER_PORTAL_PROVIDERS };
  const master = exactHostOrigin(req, env.MASTER_ORIGIN, env, isMasterHost);
  return master ? { origin: master, providers: MASTER_PROVIDERS } : null;
}

function exactHostOrigin(
  req: Request,
  configured: string | undefined,
  env: Record<string, string | undefined>,
  matches: (host: string | null, configured: string) => boolean,
): URL | null {
  if (!configured || !matches(req.headers.get("host"), configured)) return null;
  const origin = new URL(configured);
  if (!["http:", "https:"].includes(origin.protocol)) return null;
  if (env.AUTH_URL && new URL(env.AUTH_URL).protocol !== origin.protocol)
    return null;
  return new URL(origin.origin);
}

export function customerPortalAuthOrigin(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const configured = env.CUSTOMER_PORTAL_ORIGIN;
  if (!configured || !isCustomerPortalHost(req.headers.get("host"), configured))
    return null;
  const origin = new URL(configured);
  if (!["http:", "https:"].includes(origin.protocol)) return null;
  // Session cookie names depend on the scheme; the desk host must match the agency origin.
  if (env.AUTH_URL && new URL(env.AUTH_URL).protocol !== origin.protocol)
    return null;
  return new URL(origin.origin);
}

/** A custom `id` passed to Google()/Credentials() stays in `options` until Auth.js merges it per request. */
function providerId(provider: { id: string; options?: unknown }) {
  const custom = (provider.options as { id?: unknown } | undefined)?.id;
  return typeof custom === "string" ? custom : provider.id;
}

const cache = new WeakMap<AuthConfig, Map<string, AuthConfig>>();
export function customerPortalAuthConfig(
  base: AuthConfig,
  providers: readonly string[] = CUSTOMER_PORTAL_PROVIDERS,
): AuthConfig {
  const key = providers.join(",");
  const perBase = cache.get(base) ?? new Map<string, AuthConfig>();
  const cached = perBase.get(key);
  if (cached) return cached;
  const config: AuthConfig = {
    ...base,
    providers: base.providers.filter((provider) =>
      providers.includes(
        providerId(typeof provider === "function" ? provider({}) : provider),
      ),
    ),
    basePath: "/api/auth",
    trustHost: true,
  };
  setEnvDefaults(process.env, config, true);
  perBase.set(key, config);
  cache.set(base, perBase);
  return config;
}

export async function handleCustomerPortalAuth(
  req: NextRequest,
  origin: URL,
  base: AuthConfig,
  providers: readonly string[] = CUSTOMER_PORTAL_PROVIDERS,
) {
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, origin);
  return Auth(new NextRequest(url, req), customerPortalAuthConfig(base, providers));
}
