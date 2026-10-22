"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
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
    <main className="cp-login">
      <section>
        <Link href="/customer" className="cp-wordmark">
          Ideal AI <span>고객사 상담함</span>
        </Link>
        <h1>
          우리 회사의 상담을
          <br />
          한곳에서 이어가세요.
        </h1>
        <p className="cp-login-description">
          초대받은 담당자 계정으로 로그인해주세요.
        </p>
        {googleAvailable && (
          <button
            className="cp-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signIn("customer-google", { redirectTo: next });
            }}
          >
            Google로 상담함 로그인
          </button>
        )}
        <form onSubmit={submit}>
          <label>
            담당자 이메일
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
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
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy ? "로그인 중…" : "상담함으로 로그인"}
          </button>
        </form>
        <div className="cp-login-help">
          <Link href="/customer/forgot-password">비밀번호를 잊으셨나요?</Link>
        </div>
        <div className="cp-login-invite">
          <strong>처음 이용하시나요?</strong>
          <p>
            에이전시에서 받은 초대 링크로
            <br />
            계정을 활성화해주세요.
          </p>
        </div>
        <footer className="cp-login-footer">
          <span>에이전시 관리자이신가요?</span>
          <a href={`${agencyOrigin}/login`}>관리자 로그인</a>
        </footer>
      </section>
      <aside>
        <h2>
          오늘의 문의에
          <br />
          집중할 수 있도록.
        </h2>
        <p>
          고객과 나눈 대화를 읽고, 답변하고,
          <br />
          접수된 문의를 처리하세요.
        </p>
      </aside>
    </main>
  );
}
