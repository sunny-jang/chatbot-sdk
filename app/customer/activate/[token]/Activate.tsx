"use client";
import { useState } from "react";
import Link from "next/link";
export default function Activate({
  token,
  existing,
}: {
  token: string;
  existing: boolean;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/customer/activate/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "계정을 활성화하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div>
        <h1>상담함을 이용할 준비가 됐어요</h1>
        <p>담당자 이메일과 비밀번호로 로그인해주세요.</p>
        <Link className="cp-link" href="/customer/login">
          상담함 로그인
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit}>
      <h1>고객사 상담함 활성화</h1>
      {existing ? (
        <p>
          이미 등록된 계정입니다.{" "}
          <Link className="cp-link" href="/customer/login">
            해당 계정으로 로그인
          </Link>
          한 뒤 이 링크를 다시 열어 수락해주세요. 기존 에이전시 소유자는
          에이전시 로그인도 사용할 수 있습니다.
        </p>
      ) : (
        <>
          <label>
            이름
            <input
              className="cp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            비밀번호
            <input
              className="cp-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
            <small>12자 이상으로 설정해주세요.</small>
          </label>
        </>
      )}
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      <button className="cp-button" disabled={busy}>
        {busy ? "처리 중…" : existing ? "초대 수락" : "계정 활성화"}
      </button>
    </form>
  );
}
