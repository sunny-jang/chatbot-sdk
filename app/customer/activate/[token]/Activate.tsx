"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthHero, HeroFact } from "@/app/customer/components/AuthHero";

export default function Activate({
  token,
  existing,
  customerName,
  maskedEmail,
}: {
  token: string;
  existing: boolean;
  customerName: string;
  maskedEmail: string;
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
      <AuthHero
        chip="계정 활성화 완료"
        chipIcon="check"
        title="상담함을 이용할"
        accent="준비가 됐어요"
        art="key"
      >
        <HeroFact label="로그인 이메일" value={maskedEmail} icon="check" />
        <p className="cp-hero-lead">
          방금 정한 비밀번호로 로그인하면 {customerName} 상담만 표시됩니다.
        </p>
        <div className="cp-hero-actions">
          <Link className="cp-button" href="/customer/login">
            상담함 로그인
          </Link>
        </div>
      </AuthHero>
    );
  if (existing)
    return (
      <AuthHero
        chip="이미 등록된 계정"
        chipIcon="check"
        title={`${customerName} 상담함`}
        accent="초대 수락"
        art="key"
      >
        <HeroFact label="초대받은 이메일" value={maskedEmail} />
        <p className="cp-hero-lead">
          이 이메일로 이미 계정이 있어요. 로그인한 뒤 이 링크를 다시 열면
          초대가 수락됩니다. 기존 에이전시 소유자는 에이전시 로그인도 쓸 수
          있습니다.
        </p>
        <div className="cp-hero-actions">
          <Link
            className="cp-button"
            href={`/customer/login?next=${encodeURIComponent("/customer/activate/" + token)}`}
          >
            해당 계정으로 로그인
          </Link>
        </div>
      </AuthHero>
    );
  return (
    <AuthHero
      chip="본인 확인 완료"
      chipIcon="check"
      title={`${customerName} 상담함`}
      accent="계정 만들기"
      art="key"
      steps={[
        { title: "본인 확인", detail: "완료" },
        { title: "계정 만들기", detail: "이름과 비밀번호 설정" },
        { title: "상담함 시작", detail: "로그인 후 바로 이용" },
      ]}
    >
      <HeroFact label="로그인에 쓸 이메일" value={maskedEmail} />
      <form onSubmit={submit} className="cp-hero-form">
        <label>
          이름
          <input
            className="cp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="상담함에 표시될 이름"
            autoComplete="name"
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
            minLength={8}
            autoComplete="new-password"
            placeholder="8자 이상"
          />
          <small>8자 이상으로 설정해주세요.</small>
        </label>
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
        <button className="cp-button" disabled={busy}>
          {busy ? "처리 중…" : "계정 활성화"}
        </button>
      </form>
    </AuthHero>
  );
}
