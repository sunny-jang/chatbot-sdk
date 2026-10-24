"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export default function CustomerBots({
  customerId,
  bots,
}: {
  customerId: string;
  bots: { id: string; name: string; customer_id: string | null }[];
}) {
  const [botId, setBot] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/customers/${customerId}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setBot("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cp-panel">
      <h2>연결된 챗봇</h2>
      {bots.some((b) => b.customer_id === customerId) ? (
        <ul className="cp-list">
          {bots
            .filter((b) => b.customer_id === customerId)
            .map((b) => (
              <li key={b.id}>
                <span>{b.name}</span>
                <Link className="cp-link" href={`/bots/${b.id}`}>
                  설정 열기
                </Link>
              </li>
            ))}
        </ul>
      ) : (
        <p className="cp-note">아직 연결된 챗봇이 없습니다.</p>
      )}
      <form className="cp-row" onSubmit={connect}>
        <label>
          챗봇 연결
          <select
            className="cp-input"
            value={botId}
            onChange={(e) => setBot(e.target.value)}
            required
          >
            <option value="">챗봇 선택</option>
            {bots
              .filter((b) => b.customer_id !== customerId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <button className="cp-button" disabled={busy || !botId}>
          이 고객사에 연결
        </button>
      </form>
      <p className="cp-note">
        챗봇의 지식과 설정이 함께 연결됩니다. 이전 대화·신청 기록이 있는 챗봇은
        다른 고객사로 옮길 수 없습니다.
      </p>
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
