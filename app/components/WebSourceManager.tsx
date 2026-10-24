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
type Discovered = {
  via: "sitemap" | "links";
  startUrl: string;
  pages: { url: string; registered: boolean }[];
};
type ImportResult = { url: string; ok: boolean; message: string };
const IMPORT_BATCH = 3;
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
  apiBase,
  onApplied,
}: {
  botId: string;
  apiBase?: string;
  onApplied?: () => void;
  folders: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]),
    [url, setUrl] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [folder, setFolder] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [siteNotice, setSiteNotice] = useState(""),
    [site, setSite] = useState(""),
    [discovered, setDiscovered] = useState<Discovered | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [progress, setProgress] = useState<{
      done: number;
      total: number;
      results: ImportResult[];
    } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setSources(d);
  }, [botId, apiBase]);
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
      const r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`, {
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
      const r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`, {
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
      onApplied?.();
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "반영 실패");
    } finally {
      setBusy(false);
    }
  }
  async function discover() {
    setBusy(true);
    setSiteNotice("");
    setDiscovered(null);
    setProgress(null);
    try {
      const r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover", url: site }),
      });
      const d = (await r.json()) as Discovered & { error?: string };
      if (!r.ok) throw Error(d.error);
      setDiscovered(d);
      setSelected(
        new Set(d.pages.filter((p) => !p.registered).map((p) => p.url)),
      );
    } catch (e) {
      setSiteNotice(
        e instanceof Error ? e.message : "페이지를 찾지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importSelected() {
    const urls = [...selected];
    if (!urls.length) return;
    setBusy(true);
    setSiteNotice("");
    const results: ImportResult[] = [];
    setProgress({ done: 0, total: urls.length, results });
    try {
      for (let i = 0; i < urls.length; i += IMPORT_BATCH) {
        const batch = urls.slice(i, i + IMPORT_BATCH);
        let r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            urls: batch,
            folderId: folder || null,
          }),
        });
        if (r.status === 429) {
          // 고객사 데스크의 분당 요청 한도. 잠시 기다렸다가 같은 묶음을 한 번 더 보냅니다.
          await new Promise((ok) => setTimeout(ok, 30000));
          r = await fetch(`${apiBase || `/api/bots/${botId}`}/web-sources`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "import",
              urls: batch,
              folderId: folder || null,
            }),
          });
        }
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        results.push(...(d.results as ImportResult[]));
        setProgress({
          done: Math.min(i + batch.length, urls.length),
          total: urls.length,
          results: [...results],
        });
      }
      const failed = results.filter((x) => !x.ok).length;
      setSiteNotice(
        failed
          ? `${results.length - failed}개 반영, ${failed}개 실패`
          : `${results.length}개 페이지를 문서에 반영했습니다.`,
      );
      setDiscovered(null);
      setSelected(new Set());
      await load();
      onApplied?.();
      router.refresh();
    } catch (e) {
      setSiteNotice(e instanceof Error ? e.message : "가져오기 실패");
    } finally {
      setBusy(false);
    }
  }
  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
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
      <div className="border-t border-gray-200 mt-5 pt-4">
        <h3 className="font-semibold">사이트 전체 가져오기</h3>
        <p className="text-sm text-gray-500 my-2">
          사이트 주소를 넣으면 사이트맵(sitemap.xml)을 따라 페이지를 찾고, 고른
          페이지를 검토 없이 한 번에 문서로 저장합니다. 사이트맵이 없으면 첫
          페이지의 링크로 대신합니다. 한 번에 최대 300페이지.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void discover();
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            aria-label="사이트 주소"
            required
            type="url"
            maxLength={2000}
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="https://example.com"
            className="border border-gray-200 rounded-lg p-2 flex-1 min-w-48"
          />
          <button disabled={busy} className={btn}>
            {busy && !progress ? "찾는 중..." : "페이지 찾기"}
          </button>
        </form>
        {siteNotice && (
          <p role="status" className="text-sm text-violet-700 mt-3">
            {siteNotice}
          </p>
        )}
        {discovered && (
          <div className="border border-gray-200 rounded-xl p-4 mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {discovered.via === "sitemap"
                  ? "사이트맵에서"
                  : "사이트맵이 없어 첫 페이지 링크에서"}{" "}
                {discovered.pages.length}개 발견 · {selected.size}개 선택
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() =>
                    setSelected(
                      new Set(
                        discovered.pages
                          .filter((p) => !p.registered)
                          .map((p) => p.url),
                      ),
                    )
                  }
                >
                  새 페이지 모두 선택
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => setSelected(new Set())}
                >
                  선택 해제
                </button>
              </span>
            </div>
            <ul className="max-h-72 overflow-auto mt-3 text-sm divide-y divide-gray-100">
              {discovered.pages.map((p) => (
                <li key={p.url} className="py-1.5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={busy || p.registered}
                      checked={selected.has(p.url)}
                      onChange={() => toggle(p.url)}
                    />
                    <span className="break-all">
                      {p.url}
                      {p.registered && (
                        <span className="ml-2 text-xs text-gray-500">
                          이미 등록됨
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <label className="text-sm">
                폴더
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="border border-gray-200 rounded-lg p-2 ml-2"
                >
                  <option value="">미분류</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !selected.size}
                onClick={importSelected}
                className={btn + " bg-violet-600 text-white"}
              >
                {progress
                  ? `가져오는 중 ${progress.done}/${progress.total}`
                  : `${selected.size}개 페이지 가져오기`}
              </button>
            </div>
            {progress && progress.results.some((x) => !x.ok) && (
              <ul className="mt-3 text-sm text-red-600 space-y-1">
                {progress.results
                  .filter((x) => !x.ok)
                  .map((x) => (
                    <li key={x.url} className="break-all">
                      {x.url} — {x.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {!discovered && progress && progress.results.some((x) => !x.ok) && (
          <ul className="mt-3 text-sm text-red-600 space-y-1">
            {progress.results
              .filter((x) => !x.ok)
              .map((x) => (
                <li key={x.url} className="break-all">
                  {x.url} — {x.message}
                </li>
              ))}
          </ul>
        )}
      </div>
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
