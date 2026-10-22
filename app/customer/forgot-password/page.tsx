"use client";
import { useState } from "react";
import Link from "next/link";
export default function ForgotPassword() {
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/customer/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        "등록된 담당자 이메일이면 확인 링크를 발송합니다. 메일함과 스팸함을 확인해주세요.",
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="cp-auth-page">
      <section className="cp-auth-card">
        <Link href="/customer/login" className="cp-wordmark">
          Ideal AI <span>고객사 상담함</span>
        </Link>
        <h1>비밀번호를 잊으셨나요?</h1>
        <p className="cp-auth-description">
          담당자 이메일을 입력하시면
          <br />
          비밀번호 재설정 링크를 보내드려요.
        </p>
        {message ? (
          <p role="status">{message}</p>
        ) : (
          <form onSubmit={submit}>
            <label>
              담당자 이메일
              <input
                className="cp-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="cp-button" disabled={busy}>
              {busy ? "메일 요청 중…" : "재설정 메일 받기"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        <Link className="cp-auth-back" href="/customer/login">
          로그인으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
