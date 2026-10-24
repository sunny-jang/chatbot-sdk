"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthHero, HeroFact } from "@/app/customer/components/AuthHero";

export default function Activate({
  token,
  existing,
  customerName,
  maskedEmail,
  viewer,
}: {
  token: string;
  existing: boolean;
  customerName: string;
  maskedEmail: string;
  viewer: { email: string | null; matches: boolean } | null;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function activate(payload: Record<string, string>, redirect: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/customer/activate/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (redirect && d.customerId) {
        // 로그인된 기존 계정은 수락 즉시 상담함으로 보냅니다.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/customer/${d.customerId}/support`);
        return;
      }
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "계정을 활성화하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void activate({ name, password }, false);
  };
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
  if (existing && viewer?.matches)
    return (
      <AuthHero
        chip="본인 확인 완료"
        chipIcon="check"
        title={`${customerName} 상담함`}
        accent="초대 수락"
        art="key"
      >
        <HeroFact label="로그인한 계정" value={viewer.email ?? maskedEmail} icon="check" />
        <p className="cp-hero-lead">
          이미 쓰고 있는 계정이에요. 수락하면 이 계정으로 바로 {customerName}{" "}
          상담함이 열립니다.
        </p>
        <div className="cp-hero-actions">
          <button
            className="cp-button"
            disabled={busy}
            onClick={() => void activate({}, true)}
          >
            {busy ? "처리 중…" : "초대 수락하고 상담함 열기"}
          </button>
        </div>
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
      </AuthHero>
    );
  if (existing)
    return (
      <AuthHero
        chip={viewer ? "다른 계정으로 로그인됨" : "이미 등록된 계정"}
        chipIcon={viewer ? "warn" : "check"}
        title={`${customerName} 상담함`}
        accent="초대 수락"
        art="key"
      >
        <HeroFact label="초대받은 이메일" value={maskedEmail} />
        <p className="cp-hero-lead">
          {viewer ? (
            <>
              지금은 <b>{viewer.email ?? "다른"}</b> 계정으로 로그인되어 있어요.
              초대받은 이메일 계정으로 로그인한 뒤 이 링크를 다시 열어주세요.
            </>
          ) : (
            <>
              이 이메일로 이미 계정이 있어요. 로그인하면 이 화면으로 돌아와
              바로 수락할 수 있습니다. 기존 에이전시 소유자는 에이전시 로그인도
              쓸 수 있어요.
            </>
          )}
        </p>
        <div className="cp-hero-actions">
          <Link
            className="cp-button"
            href={`/customer/login?next=${encodeURIComponent("/customer/activate/" + token)}`}
          >
            {viewer ? "다른 계정으로 로그인" : "해당 계정으로 로그인"}
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
