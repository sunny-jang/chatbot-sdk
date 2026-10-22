"use client";
import { useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
export default function Invite({
  token,
  viewer,
  matches,
  googleAvailable,
}: {
  token: string;
  viewer: { name: string; email: string | null } | null;
  matches: boolean;
  googleAvailable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const invitePath = `/customer/invite/${encodeURIComponent(token)}`,
    loginPath = `/customer/login?next=${encodeURIComponent(invitePath)}`,
    endpoint = `/api/customer/invitations/${encodeURIComponent(token)}`;
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
      setMessage(
        "초대받은 이메일로 확인 링크를 보냈습니다. 15분 안에 메일의 링크를 열어주세요.",
      );
    }, "메일을 보내지 못했습니다.");
  const switchAccount = () =>
    run(async () => {
      await signOut({ redirect: false });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(loginPath);
    }, "계정을 바꾸지 못했습니다.");
  if (message) return <p role="status">{message}</p>;
  if (viewer && matches)
    return (
      <div className="cp-stack">
        <p>
          {viewer.name}({viewer.email}) 계정으로 로그인되어 있습니다. 수락하면
          이 계정으로 상담함을 사용합니다.
        </p>
        <button className="cp-button" disabled={busy} onClick={accept}>
          {busy ? "처리 중…" : "초대 수락"}
        </button>
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
      </div>
    );
  if (viewer)
    return (
      <div className="cp-stack">
        <p>
          지금 {viewer.email ?? viewer.name} 계정으로 로그인되어 있습니다.
          초대받은 이메일 계정으로 바꿔서 수락해주세요. 다른 이메일로 초대를
          넘겨받을 수는 없습니다.
        </p>
        <button className="cp-button" disabled={busy} onClick={switchAccount}>
          {busy ? "처리 중…" : "다른 계정으로 로그인"}
        </button>
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="cp-stack">
      {googleAvailable && (
        <button
          className="cp-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signIn("customer-google", { redirectTo: invitePath });
          }}
        >
          초대받은 Google 계정으로 계속
        </button>
      )}
      <p>
        이미 담당자 계정이 있나요?{" "}
        <Link className="cp-link" href={loginPath}>
          로그인한 뒤 수락
        </Link>
      </p>
      <p>
        처음이라면 초대받은 메일함에서 본인 확인을 마치고 계정을 만들 수
        있습니다.
      </p>
      <button className="cp-button" disabled={busy} onClick={sendMail}>
        {busy ? "보내는 중…" : "내 이메일로 확인 링크 받기"}
      </button>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
    </div>
  );
}
