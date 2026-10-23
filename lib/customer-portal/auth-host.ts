import { Auth, setEnvDefaults, type AuthConfig } from "@auth/core";
import { NextRequest } from "next/server";
import { isCustomerPortalHost } from "./host";

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

const cache = new WeakMap<AuthConfig, AuthConfig>();
export function customerPortalAuthConfig(base: AuthConfig): AuthConfig {
  const cached = cache.get(base);
  if (cached) return cached;
  const config: AuthConfig = {
    ...base,
    providers: base.providers.filter((provider) =>
      (CUSTOMER_PORTAL_PROVIDERS as readonly string[]).includes(
        providerId(typeof provider === "function" ? provider({}) : provider),
      ),
    ),
    basePath: "/api/auth",
    trustHost: true,
  };
  setEnvDefaults(process.env, config, true);
  cache.set(base, config);
  return config;
}

export async function handleCustomerPortalAuth(
  req: NextRequest,
  origin: URL,
  base: AuthConfig,
) {
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, origin);
  return Auth(new NextRequest(url, req), customerPortalAuthConfig(base));
}
