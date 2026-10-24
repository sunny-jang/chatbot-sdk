"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthHero, HeroFact } from "@/app/customer/components/AuthHero";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
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
      setSent(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const masked = email.includes("@")
    ? email[0] + "***@" + email.split("@")[1]
    : email;
  if (sent)
    return (
      <AuthHero
        chip="재설정 메일 요청 완료"
        title="메일함을"
        accent="확인해주세요"
        steps={[
          { title: "메일함 확인하기", detail: masked },
          { title: "재설정 메일 열기", detail: "메일의 링크 클릭 (15분 유효)" },
          { title: "새 비밀번호 설정", detail: "8자 이상" },
        ]}
      >
        <HeroFact label="요청한 이메일" value={masked} />
        <p className="cp-hero-lead" role="status">
          등록된 담당자 이메일이면 재설정 링크를 보냈어요.
          <br />
          메일이 보이지 않으면 <b>스팸함</b>도 확인해주세요.
        </p>
        <p className="cp-hero-foot">
          <Link className="cp-link" href="/customer/login">
            로그인으로 돌아가기
          </Link>
        </p>
      </AuthHero>
    );
  return (
    <AuthHero
      chip="비밀번호 찾기"
      chipIcon="key"
      title="비밀번호를"
      accent="잊으셨나요?"
      art="key"
    >
      <p className="cp-hero-lead">
        담당자 이메일을 입력하면 비밀번호 재설정 링크를 보내드려요.
      </p>
      <form onSubmit={submit} className="cp-hero-form">
        <label>
          담당자 이메일
          <input
            className="cp-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@company.co.kr"
          />
        </label>
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        <button className="cp-button" disabled={busy}>
          {busy ? "메일 요청 중…" : "재설정 메일 받기"}
        </button>
      </form>
      <p className="cp-hero-foot">
        <Link className="cp-link" href="/customer/login">
          로그인으로 돌아가기
        </Link>
      </p>
    </AuthHero>
  );
}
