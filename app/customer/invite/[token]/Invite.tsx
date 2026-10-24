"use client";
import { useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { AuthHero, HeroFact } from "@/app/customer/components/AuthHero";

export default function Invite({
  token,
  customerName,
  partnerName,
  role,
  maskedEmail,
  viewer,
  matches,
  googleAvailable,
}: {
  token: string;
  customerName: string;
  partnerName: string;
  role: string;
  maskedEmail: string;
  viewer: { name: string; email: string | null } | null;
  matches: boolean;
  googleAvailable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState("");
  const invitePath = `/customer/invite/${encodeURIComponent(token)}`,
    loginPath = `/customer/login?next=${encodeURIComponent(invitePath)}`,
    endpoint = `/api/customer/invitations/${encodeURIComponent(token)}`;
  const roleLabel = role === "admin" ? "고객사 관리자" : "상담 담당자";
  const meta = (
    <>
      초대한 곳: {partnerName} <span className="cp-hero-dot">·</span> 역할:{" "}
      {roleLabel}
    </>
  );
  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }
  const accept = () =>
    run(async () => {
      const r = await fetch(endpoint, { method: "PATCH" }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      // Discard RSC data rendered before the membership existed.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/customer/${d.customerId}/support`);
    }, "초대를 수락하지 못했습니다.");
  const sendMail = () =>
    run(async () => {
      const r = await fetch(endpoint, { method: "POST" }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSent(true);
    }, "메일을 보내지 못했습니다.");
  const switchAccount = () =>
    run(async () => {
      await signOut({ redirect: false });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(loginPath);
    }, "계정을 바꾸지 못했습니다.");
  const alert = error && (
    <p role="alert" className="cp-error">
      {error}
    </p>
  );

  if (sent)
    return (
      <AuthHero
        chip="초대 메일 발송 완료"
        title={`${customerName} 상담함에`}
        accent="초대되었습니다"
        meta={meta}
        steps={[
          { title: "메일함 확인하기", detail: maskedEmail },
          { title: "초대 메일 열기", detail: "메일의 확인 링크 클릭" },
          { title: "상담함에 접속하기", detail: "링크를 통해 바로 접속됩니다" },
        ]}
      >
        <HeroFact label="초대받은 이메일" value={maskedEmail} />
        <p className="cp-hero-lead" role="status">
          초대 메일로 확인 링크를 보냈습니다.
          <br />
          <b>15분 안에</b> 메일의 링크를 열어주세요.
        </p>
      </AuthHero>
    );

  if (viewer && matches)
    return (
      <AuthHero
        chip="초대 확인됨"
        chipIcon="check"
        title={`${customerName} 상담함에`}
        accent="초대되었습니다"
        meta={meta}
      >
        <HeroFact label="로그인한 계정" value={viewer.email ?? viewer.name} icon="check" />
        <p className="cp-hero-lead">
          이 계정으로 수락하면 바로 {customerName} 상담함을 사용할 수 있어요.
        </p>
        <div className="cp-hero-actions">
          <button className="cp-button" disabled={busy} onClick={accept}>
            {busy ? "처리 중…" : "초대 수락하고 상담함 열기"}
          </button>
        </div>
        {alert}
      </AuthHero>
    );

  if (viewer)
    return (
      <AuthHero
        chip="다른 계정으로 로그인됨"
        chipIcon="warn"
        title={`${customerName} 상담함에`}
        accent="초대되었습니다"
        meta={meta}
      >
        <HeroFact label="초대받은 이메일" value={maskedEmail} />
        <p className="cp-hero-lead">
          지금은 <b>{viewer.email ?? viewer.name}</b> 계정으로 로그인되어
          있어요. 초대받은 이메일 계정으로 바꿔서 수락해주세요. 다른 이메일로
          초대를 넘겨받을 수는 없습니다.
        </p>
        <div className="cp-hero-actions">
          <button className="cp-button" disabled={busy} onClick={switchAccount}>
            {busy ? "처리 중…" : "다른 계정으로 로그인"}
          </button>
        </div>
        {alert}
      </AuthHero>
    );

  return (
    <AuthHero
      chip="상담함 초대"
      title={`${customerName} 상담함에`}
      accent="초대되었습니다"
      meta={meta}
      steps={[
        { title: "본인 확인", detail: "초대받은 이메일로 확인 링크 받기" },
        { title: "계정 만들기", detail: "이름과 비밀번호(8자 이상) 설정" },
        { title: "상담함 시작", detail: `${customerName} 상담만 표시됩니다` },
      ]}
    >
      <HeroFact label="초대받은 이메일" value={maskedEmail} />
      <p className="cp-hero-lead">
        처음이라면 초대받은 메일함에서 본인 확인을 마치고 계정을 만들 수
        있어요.
      </p>
      <div className="cp-hero-actions">
        <button className="cp-button" disabled={busy} onClick={sendMail}>
          {busy ? "보내는 중…" : "내 이메일로 확인 링크 받기"}
        </button>
        {googleAvailable && (
          <button
            className="cp-button cp-button-secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signIn("customer-google", { redirectTo: invitePath });
            }}
          >
            초대받은 Google 계정으로 계속
          </button>
        )}
      </div>
      <p className="cp-hero-foot">
        이미 담당자 계정이 있나요?{" "}
        <Link className="cp-link" href={loginPath}>
          로그인한 뒤 수락
        </Link>
      </p>
      {alert}
    </AuthHero>
  );
}
