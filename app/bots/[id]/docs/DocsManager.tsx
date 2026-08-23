"use client";

import { useState } from "react";

type Folder = { id: string; name: string; parent_id: string | null };
type Doc = { id: string; folder_id: string | null; title: string; content: string; created_at: number };

export default function DocsManager({
  botId,
  initialDocs,
  initialFolders,
}: {
  botId: string;
  initialDocs: Doc[];
  initialFolders: Folder[];
}) {
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = 전체
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Add document form
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [docFolder, setDocFolder] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Add folder form
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string>("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);

  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  // ZIP upload
  const [zipUploading, setZipUploading] = useState(false);
  const [zipResult, setZipResult] = useState<{ created: number; skipped: number; failed: { filename: string; error: string }[]; unsupported: string[] } | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, folderMode = false) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setZipUploading(true);
    setZipResult(null);
    setZipError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) {
        form.append("files", file);
        if (folderMode) {
          form.append("paths", (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name);
        }
      }
      if (selectedFolder) form.append("folder_id", selectedFolder);
      const res = await fetch(`/api/bots/${botId}/docs/upload`, { method: "POST", body: form });
      let data: { created?: unknown[]; skipped?: number; failed?: { filename: string; error: string }[]; unsupported?: string[]; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        setZipError("서버 응답 오류가 발생했습니다. 파일 수가 많으면 나눠서 업로드해보세요.");
        return;
      }
      if (!res.ok) {
        setZipError(data.error || `업로드 실패 (${res.status})`);
        return;
      }
      setDocs((prev) => [...(data.created as typeof prev), ...prev]);
      setZipResult({ created: (data.created ?? []).length, skipped: data.skipped ?? 0, failed: data.failed ?? [], unsupported: data.unsupported ?? [] });
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.");
    } finally {
      setZipUploading(false);
      e.target.value = "";
    }
  }

  // Build tree
  const rootFolders = folders.filter((f) => !f.parent_id);
  const childFolders = (parentId: string) => folders.filter((f) => f.parent_id === parentId);

  const visibleDocs = selectedFolder === null
    ? docs
    : docs.filter((d) => d.folder_id === selectedFolder);

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          folder_id: docFolder || null,
        }),
      });
      const doc = await res.json();
      setDocs((prev) => [doc, ...prev]);
      setTitle("");
      setContent("");
      setDocFolder(selectedFolder ?? "");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDoc(docId: string) {
    await fetch(`/api/bots/${botId}/docs/${docId}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  }

  async function handleAddFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setAddingFolder(true);
    try {
      const res = await fetch(`/api/bots/${botId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), parent_id: newFolderParent || null }),
      });
      const folder = await res.json();
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName("");
      setNewFolderParent("");
      setShowFolderForm(false);
    } finally {
      setAddingFolder(false);
    }
  }

  async function handleDeleteFolder(folderId: string) {
    await fetch(`/api/bots/${botId}/folders/${folderId}`, { method: "DELETE" });
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setDocs((prev) => prev.map((d) => d.folder_id === folderId ? { ...d, folder_id: null } : d));
    if (selectedFolder === folderId) setSelectedFolder(null);
  }

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function FolderNode({ folder, depth = 0 }: { folder: Folder; depth?: number }) {
    const children = childFolders(folder.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolder === folder.id;
    const count = docs.filter((d) => d.folder_id === folder.id).length;

    return (
      <div>
        <div
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${
            isSelected ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700"
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}
              className="text-gray-400 hover:text-gray-600 w-4 text-xs"
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span
            className="flex-1 flex items-center gap-1.5 text-sm min-w-0"
            onClick={() => setSelectedFolder(folder.id)}
          >
            <span>{isExpanded ? "📂" : "📁"}</span>
            <span className="truncate">{folder.name}</span>
            <span className="text-xs text-gray-400 ml-auto shrink-0">{count}</span>
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
            className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-600 transition-opacity ml-1"
          >
            ✕
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {children.map((child) => (
              <FolderNode key={child.id} folder={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-5 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-52 shrink-0 flex flex-col gap-2">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex-1">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">폴더</span>
            <button
              onClick={() => setShowFolderForm(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              + 추가
            </button>
          </div>

          <div className="p-1">
            {/* All docs */}
            <div
              onClick={() => setSelectedFolder(null)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                selectedFolder === null ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              <span>🗂️</span>
              <span className="flex-1">전체 문서</span>
              <span className="text-xs text-gray-400">{docs.length}</span>
            </div>

            {rootFolders.map((folder) => (
              <FolderNode key={folder.id} folder={folder} />
            ))}
          </div>
        </div>

        {/* Folder add form */}
        {showFolderForm && (
          <form onSubmit={handleAddFolder} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">새 폴더</p>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="폴더 이름"
              required
              autoFocus
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {folders.length > 0 && (
              <select
                value={newFolderParent}
                onChange={(e) => setNewFolderParent(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">최상위 폴더</option>
                {rootFolders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={addingFolder || !newFolderName.trim()}
                className="flex-1 py-1.5 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-50"
              >
                {addingFolder ? "..." : "만들기"}
              </button>
              <button
                type="button"
                onClick={() => setShowFolderForm(false)}
                className="flex-1 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg"
              >
                취소
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 space-y-4">
        {/* Add doc form */}
        <form
          onSubmit={handleAddDoc}
          className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 text-sm">문서 추가</h3>
            <div className="flex items-center gap-2">
              <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                zipUploading ? "bg-gray-100 text-gray-400" : "bg-orange-50 text-orange-600 hover:bg-orange-100"
              }`}>
                <span>📄</span>
                {zipUploading ? "처리 중..." : "파일 업로드"}
                <input
                  type="file"
                  accept=".zip,.pdf,.docx,.hwp,.hwpx,.html,.htm,.txt,.md,.csv"
                  multiple
                  className="hidden"
                  disabled={zipUploading}
                  onChange={(e) => handleFileUpload(e, false)}
                />
              </label>
              <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                zipUploading ? "bg-gray-100 text-gray-400" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
              }`}>
                <span>📂</span>
                폴더 업로드
                <input
                  type="file"
                  className="hidden"
                  disabled={zipUploading}
                  // @ts-expect-error webkitdirectory is non-standard
                  webkitdirectory=""
                  onChange={(e) => handleFileUpload(e, true)}
                />
              </label>
              <select
                value={docFolder}
                onChange={(e) => setDocFolder(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">📁 폴더 없음</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>📁 {f.name}</option>
                ))}
              </select>
            </div>
          </div>

          {zipUploading && (
            <div className="text-xs rounded-lg px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-2">
              <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              임베딩 생성 중... 파일 수에 따라 1분 내외 소요될 수 있어요. 창을 닫지 마세요.
            </div>
          )}
          {zipError && (
            <div className="text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200">
              ❌ {zipError}
            </div>
          )}
          {zipResult && (
            <div className="space-y-1.5">
              <div className={`text-xs rounded-lg px-3 py-2 ${zipResult.created > 0 ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"}`}>
                {zipResult.created > 0 ? "✅" : "⚠️"} {zipResult.created}개 문서 추가됨
                {zipResult.skipped > 0 && (
                  <span className="ml-2 opacity-60">· {zipResult.skipped}개 이미 존재해서 건너뜀</span>
                )}
                {zipResult.unsupported.length > 0 && (
                  <span className="ml-2 opacity-60">· {zipResult.unsupported.length}개 미지원 형식</span>
                )}
              </div>
              {zipResult.failed.map((f) => (
                <div key={f.filename} className="text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200">
                  ❌ <span className="font-medium">{f.filename}</span> — {f.error}
                </div>
              ))}
            </div>
          )}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="문서 제목 (예: 환불 정책, 서비스 소개)"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="문서 내용을 입력하세요. 이 내용을 바탕으로 AI가 답변합니다."
            required
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{content.length.toLocaleString()}자</p>
            <button
              type="submit"
              disabled={saving || !title.trim() || !content.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "임베딩 생성 중..." : "저장"}
            </button>
          </div>
        </form>

        {/* Doc list */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-sm font-medium text-gray-700">
            {selectedFolder === null
              ? "전체 문서"
              : `📁 ${folders.find((f) => f.id === selectedFolder)?.name}`}
          </span>
          <span className="text-xs text-gray-400">({visibleDocs.length}건)</span>
        </div>

        {visibleDocs.length === 0 ? (
          <div className="text-center py-12 text-gray-400 bg-white border border-gray-200 rounded-xl">
            <div className="text-3xl mb-2">📄</div>
            <p className="text-sm">문서가 없어요</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleDocs.map((doc) => {
              const folderName = folders.find((f) => f.id === doc.folder_id)?.name;
              return (
                <div key={doc.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4">
                    <span className="text-lg">📄</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{doc.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {folderName && <span className="text-blue-500 mr-1.5">📁 {folderName} ·</span>}
                        {doc.content.length.toLocaleString()}자 ·{" "}
                        {new Date(Number(doc.created_at) * 1000).toLocaleDateString("ko-KR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {expandedDoc === doc.id ? "접기" : "보기"}
                      </button>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  {expandedDoc === doc.id && (
                    <div className="px-5 pb-4 border-t border-gray-100">
                      <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed mt-3 max-h-60 overflow-y-auto">
                        {doc.content}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
