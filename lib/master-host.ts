/**
 * Platform master console lives on its own host (MASTER_ORIGIN, e.g. https://master.example.com),
 * mirroring the desk portal: exact configured host only, no wildcard subdomains.
 */
export function isMasterHost(
  host: string | null,
  configured = process.env.MASTER_ORIGIN,
) {
  if (!host || !configured) return false;
  try {
    return host.toLowerCase() === new URL(configured).host.toLowerCase();
  } catch {
    return false;
  }
}
/** Only the console, its API, auth and the shared login exist on the master host. */
export function masterHostPath(path: string) {
  if (path === "/") return "/admin";
  return path;
}
export function masterHostAllows(path: string) {
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path.startsWith("/api/admin") ||
    path.startsWith("/api/auth/") ||
    path === "/login" ||
    path === "/robots.txt"
  );
}
export function masterOrigin(env: Record<string, string | undefined> = process.env) {
  try {
    return env.MASTER_ORIGIN ? new URL(env.MASTER_ORIGIN).origin : null;
  } catch {
    return null;
  }
}
