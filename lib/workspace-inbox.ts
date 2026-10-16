export function filterInbox<
  T extends {
    status: string;
    requested_at: number;
    customer_name: string | null;
    bot_name: string;
    last_message: string | null;
  },
>(items: T[], status: string, query: string): T[] {
  const search = query.trim().toLocaleLowerCase();
  const priority: Record<string, number> = { waiting: 0, active: 1, closed: 2 };
  return items
    .filter(
      (item) =>
        (!status || item.status === status) &&
        `${item.customer_name || ""} ${item.bot_name} ${item.last_message || ""}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort(
      (a, b) =>
        (priority[a.status] ?? 3) - (priority[b.status] ?? 3) ||
        Number(a.requested_at) - Number(b.requested_at),
    );
}
/** Sending must not erase a newer draft written while the previous reply was in flight. */
export function draftAfterSend(current: string | undefined, sent: string) {
  return current === sent ? "" : current || "";
}
