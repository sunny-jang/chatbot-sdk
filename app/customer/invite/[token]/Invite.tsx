"use client";
import { useState } from "react";
export default function Invite({ token }: { token: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/customer/invitations/${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        "초대받은 이메일로 확인 링크를 보냈습니다. 15분 안에 메일의 링크를 열어주세요.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "메일을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {message ? (
        <p role="status">{message}</p>
      ) : (
        <button
          className="cp-button"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? "보내는 중…" : "내 이메일로 확인 링크 받기"}
        </button>
      )}
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
    </div>
  );
}
