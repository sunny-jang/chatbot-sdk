import sql from "@/lib/neon";
import { customerPageAccess } from "@/lib/customer-portal/page";
import Settings from "@/app/customers/[customerId]/Settings";
export default async function CustomerSettings({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  await customerPageAccess(customerId, "customer.update");
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
    </>
  );
}
