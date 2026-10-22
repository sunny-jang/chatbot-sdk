import Reset from "./Reset";
export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="cp-pick cp-panel cp-details">
      <Reset token={token} />
    </main>
  );
}
