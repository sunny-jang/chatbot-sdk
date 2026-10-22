"use client";
import { useState } from "react";
import Link from "next/link";
export default function Reset({ token }: { token: string }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch(
        `/api/customer/password-reset/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return done ? (
    <div>
      <h1>비밀번호를 변경했습니다</h1>
      <p>이전 로그인 세션은 만료됩니다.</p>
      <Link className="cp-link" href="/customer/login">
        다시 로그인
      </Link>
    </div>
  ) : (
    <form onSubmit={submit}>
      <h1>새 비밀번호 설정</h1>
      <label>
        새 비밀번호
        <input
          className="cp-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          autoComplete="new-password"
        />
      </label>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
      <button className="cp-button" disabled={busy}>
        비밀번호 변경
      </button>
    </form>
  );
}
