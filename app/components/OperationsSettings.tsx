"use client";
import { useEffect, useState } from "react";
import {
  defaultRequestSettings,
  type RequestSettings,
} from "@/lib/operations/settings";
export default function OperationsSettings({ botId }: { botId: string }) {
  const [summary, setSummary] = useState(false),
    [settings, setSettings] = useState<RequestSettings>(defaultRequestSettings),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/bots/${botId}/operations`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (active) {
          setSummary(d.summaryEnabled);
          setSettings(d.requests);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [botId]);
  function field<K extends keyof RequestSettings>(
    key: K,
    value: RequestSettings[K],
  ) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch(`/api/bots/${botId}/operations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryEnabled: summary, requests: settings }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSettings(d.requests);
      setNotice("설정을 저장했습니다.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <h2 className="text-lg font-bold mb-3">상담 요약·신청 설정</h2>
      <label className="flex gap-2 items-center">
        <input
          type="checkbox"
          checked={summary}
          onChange={(e) => setSummary(e.target.checked)}
          disabled={!ready}
        />
        상담 인계 시 AI 요약 사용
      </label>
      <p className="text-xs text-gray-500 mt-1">
        고객사 API 키로 생성하며 추가 모델 비용이 발생합니다. 실패 시 최근 대화
        발췌를 전달합니다.
      </p>
      <div className="flex gap-5 my-4">
        <label>
          <input
            type="checkbox"
            disabled={!ready}
            checked={settings.quote}
            onChange={(e) => field("quote", e.target.checked)}
          />{" "}
          견적 요청
        </label>
        <label>
          <input
            type="checkbox"
            disabled={!ready}
            checked={settings.consultation}
            onChange={(e) => field("consultation", e.target.checked)}
          />{" "}
          상담 신청
        </label>
      </div>
      <label className="block mb-3">
        <input
          type="checkbox"
          checked={settings.company}
          onChange={(e) => field("company", e.target.checked)}
        />{" "}
        회사명 입력 표시 (선택)
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          연락처 규칙
          <select
            value={settings.contact}
            onChange={(e) =>
              field("contact", e.target.value as RequestSettings["contact"])
            }
            className="block border border-gray-200 rounded-lg p-2 mt-1"
          >
            <option value="either">이메일 또는 전화번호</option>
            <option value="email">이메일 필수</option>
            <option value="phone">전화번호 필수</option>
          </select>
        </label>
        <label className="text-sm">
          개인정보 보유 기간 (일)
          <input
            type="number"
            min={1}
            max={365}
            value={settings.retentionDays}
            onChange={(e) => field("retentionDays", Number(e.target.value))}
            className="block border border-gray-200 rounded-lg p-2 mt-1"
          />
        </label>
      </div>
      <label className="block text-sm mt-4">
        개인정보 수집 안내
        <textarea
          rows={4}
          maxLength={5000}
          value={settings.consentText}
          onChange={(e) => field("consentText", e.target.value)}
          placeholder="수집 목적, 항목, 보유 기간, 동의 거부 안내를 작성하세요."
          className="block w-full border border-gray-200 rounded-lg p-3 mt-1"
        />
      </label>
      <p className="text-xs text-gray-500 mt-2">
        설정한 기간이 지난 신청·메모·요약은 정리됩니다. 안내문에도 같은 보유
        기간을 기재해주세요.
      </p>
      <div className="flex gap-3 items-center mt-4">
        <button
          disabled={busy || !ready}
          onClick={save}
          className="bg-violet-600 text-white px-4 py-2 rounded-lg disabled:opacity-40"
        >
          {busy ? "저장 중" : "설정 저장"}
        </button>
        <p role="status" className="text-sm">
          {notice}
        </p>
      </div>
    </section>
  );
}
