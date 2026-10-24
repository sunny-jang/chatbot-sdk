"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthHero } from "@/app/customer/components/AuthHero";

export default function Reset({ token }: { token: string }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    setError("");
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
  if (done)
    return (
      <AuthHero
        chip="비밀번호 변경 완료"
        chipIcon="check"
        title="새 비밀번호로"
        accent="다시 로그인해주세요"
        art="key"
      >
        <p className="cp-hero-lead">
          안전을 위해 이전 로그인 세션은 모두 만료됩니다.
        </p>
        <div className="cp-hero-actions">
          <Link className="cp-button" href="/customer/login">
            상담함 로그인
          </Link>
        </div>
      </AuthHero>
    );
  return (
    <AuthHero
      chip="비밀번호 재설정"
      chipIcon="key"
      title="새 비밀번호를"
      accent="설정해주세요"
      art="key"
    >
      <form onSubmit={submit} className="cp-hero-form">
        <label>
          새 비밀번호
          <input
            className="cp-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="8자 이상"
          />
        </label>
        <label>
          새 비밀번호 확인
          <input
            className="cp-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        <button className="cp-button" disabled={busy}>
          {busy ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </AuthHero>
  );
}
