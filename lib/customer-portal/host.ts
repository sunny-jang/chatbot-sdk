/** Exact configured host only; arbitrary subdomains never grant a customer identity. */
export function isCustomerPortalHost(
  host: string | null,
  configured = process.env.CUSTOMER_PORTAL_ORIGIN,
) {
  if (!host || !configured) return false;
  try {
    return host.toLowerCase() === new URL(configured).host.toLowerCase();
  } catch {
    return false;
  }
}
export function customerHostPath(path: string) {
  if (path === "/") return "/customer";
  if (path === "/login") return "/customer/login";
  if (path.startsWith("/invite/")) return "/customer" + path;
  if (path.startsWith("/activate/")) return "/customer" + path;
  if (path === "/forgot-password" || path.startsWith("/reset-password/"))
    return "/customer" + path;
  return path;
}
