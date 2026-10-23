"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import LoginShowcase from "@/app/components/LoginShowcase";
export default function CustomerLogin({
  agencyOrigin,
  next,
  googleAvailable,
  oauthError,
}: {
  agencyOrigin: string;
  next: string;
  googleAvailable: boolean;
  oauthError: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(oauthError);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await signIn("customer-credentials", {
        email,
        password,
        redirect: false,
      });
      if (!r?.ok || r.error) {
        setError("이메일·비밀번호 또는 고객사 접근 권한을 확인해주세요.");
        return;
      }
      // Discard unauthenticated RSC prefetches after establishing the host-only session.
      window.location.assign(next);
    } catch {
      setError("로그인하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-split">
      <section>
        <Link href="/customer" className="auth-brand">
          <Image
            src="/logo.png"
            alt="Ideal AI"
            width={120}
            height={36}
            priority
            unoptimized
            style={{ width: 120, height: "auto" }}
          />
          <span>고객사 상담함</span>
        </Link>
        <h1>상담함 로그인</h1>
        <p className="auth-lead">
          초대받은 담당자 계정으로 로그인하면 우리 회사의 상담만 표시됩니다.
        </p>
        {googleAvailable && (
          <>
            <button
              type="button"
              className="auth-secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signIn("customer-google", { redirectTo: next });
              }}
            >
              Google로 로그인
            </button>
            <div className="auth-divider">또는 이메일로</div>
          </>
        )}
        <form onSubmit={submit}>
          <label className="auth-field">
            담당자 이메일
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.co.kr"
              required
            />
          </label>
          <label className="auth-field">
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <button className="auth-submit" disabled={busy}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
        <div className="auth-links">
          <Link href="/customer/forgot-password">비밀번호를 잊으셨나요?</Link>
        </div>
        <div className="auth-note">
          <strong>처음 이용하시나요?</strong>
          에이전시에서 받은 초대 링크를 열어 계정을 활성화한 뒤 로그인할 수
          있습니다.
        </div>
        <footer className="auth-footer">
          <span>에이전시 관리자이신가요?</span>
          <a href={`${agencyOrigin}/login`}>에이전시 워크스페이스 로그인</a>
        </footer>
      </section>
      <LoginShowcase variant="desk" />
    </main>
  );
}
