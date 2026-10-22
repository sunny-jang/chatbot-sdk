/** 신원과 공간을 분리한 후 사용하는 정책. 기존 tenant 세션의 대체 인증 수단이 아니다. */
export type CustomerRole = "owner" | "admin" | "agent";
export type Permission =
  | "customer.read"
  | "customer.update"
  | "customer.create"
  | "support.read"
  | "support.work"
  | "support.reassign"
  | "requests.read"
  | "requests.update"
  | "bot.read"
  | "bot.configure"
  | "bot.create"
  | "bot.delete"
  | "bot.move"
  | "knowledge.manage"
  | "bot.test"
  | "installation.read"
  | "members.agent"
  | "members.admin"
  | "analytics.read"
  | "partner.secrets"
  | "partner.billing";

const agent: readonly Permission[] = [
  "customer.read",
  "support.read",
  "support.work",
  "requests.read",
  "requests.update",
];
const admin: readonly Permission[] = [
  ...agent,
  "customer.update",
  "support.reassign",
  "bot.read",
  "bot.configure",
  "knowledge.manage",
  "bot.test",
  "installation.read",
  "members.agent",
  "analytics.read",
];
const owner: readonly Permission[] = [
  ...admin,
  "customer.create",
  "bot.create",
  "bot.delete",
  "bot.move",
  "members.admin",
  "partner.secrets",
  "partner.billing",
];
const permissions: Record<CustomerRole, readonly Permission[]> = {
  agent,
  admin,
  owner,
};

/** 알 수 없는 역할은 거부. 플랫폼 마스터는 고객사 권한을 자동 상속하지 않는다. */
export function hasPermission(role: unknown, permission: Permission): boolean {
  if (role !== "owner" && role !== "admin" && role !== "agent") return false;
  return permissions[role].includes(permission);
}

export function canManageCustomerMember(
  actor: { userId: string; role: CustomerRole },
  target: { userId: string; role: "admin" | "agent" },
  nextRole: "admin" | "agent" | null,
): boolean {
  if (actor.userId === target.userId) return false;
  if (actor.role === "owner") return true;
  return (
    actor.role === "admin" && target.role === "agent" && nextRole !== "admin"
  );
}

export function normalizeIdentityEmail(value: string): string {
  return value.trim().toLowerCase();
}
