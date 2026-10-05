"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Source = {
  folder_id: string | null;
  id: string;
  url: string;
  title: string;
  content: string;
  checked_at: number;
  applied_at: number;
  last_error: string | null;
};
type Preview = {
  previewId: string;
  title: string;
  content: string;
  finalUrl: string;
  previousContent: string | null;
};
export default function WebSourceManager({
  botId,
  folders,
}: {
  botId: string;
  folders: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]),
    [url, setUrl] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [folder, setFolder] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/bots/${botId}/web-sources`);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setSources(d);
  }, [botId]);
  useEffect(() => {
    const timer = setTimeout(
      () => void load().catch((e) => setNotice(e.message)),
      0,
    );
    return () => clearTimeout(timer);
  }, [load]);
  async function fetchPage(source?: Source) {
    setFolder(source?.folder_id || "");
    setBusy(true);
    setNotice("");
    setPreview(null);
    try {
      const r = await fetch(`/api/bots/${botId}/web-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          url: source?.url || url,
          sourceId: source?.id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.unchanged) setNotice("원본 내용이 변경되지 않았습니다.");
      else setPreview(d);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "수집 실패");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch(`/api/bots/${botId}/web-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          ...preview,
          folderId: folder || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setPreview(null);
      setNotice("문서에 반영했습니다.");
      await load();
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "반영 실패");
    } finally {
      setBusy(false);
    }
  }
  const btn =
    "border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:opacity-40";
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <h2 className="text-lg font-bold">URL로 지식 가져오기</h2>
      <p className="text-sm text-gray-500 my-2">
        공개 HTML 페이지를 가져와 검토 후 저장합니다. 로그인·브라우저 실행이
        필요한 페이지는 지원하지 않습니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void fetchPage();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          aria-label="웹페이지 URL"
          required
          type="url"
          maxLength={2000}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/faq"
          className="border border-gray-200 rounded-lg p-2 flex-1 min-w-48"
        />
        <button disabled={busy} className={btn}>
          {busy ? "처리 중..." : "가져오기"}
        </button>
      </form>
      {notice && (
        <p role="status" className="text-sm text-violet-700 mt-3">
          {notice}
        </p>
      )}
      {preview && (
        <div className="border border-gray-200 rounded-xl p-4 mt-4">
          <p className="text-sm text-gray-500 break-all">
            원본: {preview.finalUrl}
          </p>
          {preview.previousContent && (
            <details className="my-3">
              <summary>기존 내용 비교</summary>
              <pre className="whitespace-pre-wrap text-sm max-h-64 overflow-auto p-3 bg-gray-50">
                {preview.previousContent}
              </pre>
              <p className="text-sm text-amber-700">
                반영 시 기존 문서와 직접 편집한 내용이 아래 내용으로 교체됩니다.
              </p>
            </details>
          )}
          <label className="block text-sm mt-3">
            제목
            <input
              value={preview.title}
              maxLength={300}
              onChange={(e) =>
                setPreview({ ...preview, title: e.target.value })
              }
              className="border border-gray-200 rounded-lg p-2 w-full my-1"
            />
          </label>
          <label className="block text-sm">
            새 본문
            <textarea
              rows={10}
              maxLength={50000}
              value={preview.content}
              onChange={(e) =>
                setPreview({ ...preview, content: e.target.value })
              }
              className="border border-gray-200 rounded-lg p-2 w-full my-1"
            />
          </label>
          <label className="text-sm">
            폴더
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="border border-gray-200 rounded-lg p-2 m-2"
            >
              <option value="">미분류</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 mt-3">
            <button
              disabled={
                busy || !preview.title.trim() || !preview.content.trim()
              }
              onClick={apply}
              className={btn + " bg-violet-600 text-white"}
            >
              검토 완료·문서 반영
            </button>
            <button
              disabled={busy}
              className={btn}
              onClick={() => setPreview(null)}
            >
              취소
            </button>
          </div>
        </div>
      )}
      {sources.map((s) => (
        <article key={s.id} className="border-t border-gray-200 mt-4 pt-3">
          <div className="flex justify-between gap-3">
            <div>
              <b>{s.title}</b>
              <p className="text-xs text-gray-500 break-all">{s.url}</p>
              <p className="text-xs text-gray-500 mt-1">
                확인:{" "}
                {new Date(Number(s.checked_at) * 1000).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}{" "}
                · 반영:{" "}
                {new Date(Number(s.applied_at) * 1000).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </p>
              {s.last_error && (
                <p className="text-sm text-red-600">{s.last_error}</p>
              )}
            </div>
            <button
              disabled={busy}
              className={btn}
              onClick={() => fetchPage(s)}
            >
              다시 가져오기
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
