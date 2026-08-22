import sql from "./neon";

export function isAdminEmail(email: string): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase());
}

export async function syncAdminRole(tenantId: string, email: string) {
  const admin = isAdminEmail(email);
  await sql`UPDATE tenants SET is_admin = ${admin} WHERE id = ${tenantId}`;
  return admin;
}

export const COOKIE_OPTS = (maxAge = 60 * 60 * 24 * 30) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge,
  path: "/",
});
