import sql from "@/lib/neon";
import { customerPageAccess } from "@/lib/customer-portal/page";
import Settings from "@/app/customers/[customerId]/Settings";
import DataConnectionManager from "@/app/components/DataConnectionManager";
import { tenantDbRowLimit } from "@/lib/data-connections/store";
import type { AccessDatabase } from "@/lib/access/schema";
import { hasPermission } from "@/lib/access/policy";
export default async function CustomerSettings({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const access = await customerPageAccess(customerId, "customer.update");
  const [c] =
    await sql`SELECT name,website,status FROM customers WHERE id=${customerId}`;
  return (
    <>
      <h1>고객사 설정</h1>
      <Settings
        customerId={customerId}
        initialName={String(c.name)}
        initialWebsite={c.website ? String(c.website) : null}
        status={String(c.status)}
      />
      <DataConnectionManager
        customerId={customerId}
        portal
        canManage={hasPermission(access.grant.role, "settings.manage")}
        planBlocked={(await tenantDbRowLimit(sql as unknown as AccessDatabase, access.grant.tenant_id)) <= 0}
      />
    </>
  );
}
