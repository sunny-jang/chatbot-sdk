import type { AccessDatabase } from "./schema";
import { hasPermission, type CustomerRole, type Permission } from "./policy";

export type CustomerGrant = {
  user_id: string;
  tenant_id: string;
  customer_id: string;
  role: CustomerRole;
};

/** Each invocation reads live DB membership. No JWT role or client-selected tenant is trusted. */
export async function resolveCustomerAccess(
  db: AccessDatabase,
  userId: string,
  customerId: string,
  permission: Permission,
): Promise<CustomerGrant | null> {
  const [grant] = await db<CustomerGrant[]>`
    SELECT u.id AS user_id, c.tenant_id, c.id AS customer_id,
      CASE WHEN p.user_id IS NOT NULL THEN 'owner' ELSE m.role END AS role
    FROM customers c JOIN users u ON u.id=${userId} AND u.status='active'
    LEFT JOIN partner_memberships p ON p.tenant_id=c.tenant_id AND p.user_id=u.id AND p.status='active'
    LEFT JOIN customer_memberships m ON m.customer_id=c.id AND m.user_id=u.id AND m.status='active'
    WHERE c.id=${customerId} AND c.status='active' AND (p.user_id IS NOT NULL OR m.user_id IS NOT NULL)`;
  return grant && hasPermission(grant.role, permission) ? grant : null;
}

export async function resolveBotAccess(
  db: AccessDatabase,
  userId: string,
  botId: string,
  permission: Permission,
): Promise<CustomerGrant | null> {
  const [bot] = await db`SELECT b.customer_id FROM bots b JOIN customers c
    ON c.id=b.customer_id AND c.tenant_id=b.tenant_id WHERE b.id=${botId}`;
  if (!bot?.customer_id) return null;
  return resolveCustomerAccess(db, userId, String(bot.customer_id), permission);
}

export async function listAccessibleCustomers(
  db: AccessDatabase,
  userId: string,
) {
  return db<
    { id: string; tenant_id: string; name: string; role: CustomerRole }[]
  >`
    SELECT c.id,c.tenant_id,c.name,
      CASE WHEN p.user_id IS NOT NULL THEN 'owner' ELSE m.role END AS role
    FROM customers c JOIN users u ON u.id=${userId} AND u.status='active'
    LEFT JOIN partner_memberships p ON p.tenant_id=c.tenant_id AND p.user_id=u.id AND p.status='active'
    LEFT JOIN customer_memberships m ON m.customer_id=c.id AND m.user_id=u.id AND m.status='active'
    WHERE c.status='active' AND (p.user_id IS NOT NULL OR m.user_id IS NOT NULL)
    ORDER BY c.created_at,c.id`;
}
