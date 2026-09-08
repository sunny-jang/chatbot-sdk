"use client";

import { useState } from "react";

type QaPair = {
  id: string;
  bot_id: string;
  folder_id: string | null;
  question: string;
  answer: string;
  created_at: number;
};
type QaFolder = { id: string; bot_id: string; name: string; created_at: number };

export default function QaManager({
  botId,
  initialPairs,
  initialFolders,
}: {
  botId: string;
  initialPairs: QaPair[];
  initialFolders: QaFolder[];
}) {
  const [pairs, setPairs] = useState<QaPair[]>(initialPairs);
  const [folders, setFolders] = useState<QaFolder[]>(initialFolders);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [saving, setSaving] = useState(false);

  const visiblePairs = selectedFolder ? pairs.filter((p) => p.folder_id === selectedFolder) : pairs;

  async function handleAddFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolder.trim()) return;
    setAddingFolder(true);
    const res = await fetch(`/api/bots/${botId}/qa-folders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolder.trim() }),
    });
    if (res.ok) { const folder = await res.json(); setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name))); setNewFolder(""); }
    setAddingFolder(false);
  }

  async function handleDeleteFolder(folderId: string) {
    if (!confirm("이 폴더를 삭제할까요? Q&A는 전체 목록으로 이동합니다.")) return;
    await fetch(`/api/bots/${botId}/qa-folders/${folderId}`, { method: "DELETE" });
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setPairs((prev) => prev.map((p) => p.folder_id === folderId ? { ...p, folder_id: null } : p));
    if (selectedFolder === folderId) setSelectedFolder(null);
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMessage("");
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`/api/bots/${botId}/qa/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "업로드에 실패했습니다.");
      const imported = data.imported as QaPair[];
      setPairs((prev) => [...imported, ...prev.filter((p) => !new Set(imported.map((i) => i.id)).has(p.id))]);
      const folderRows = await fetch(`/api/bots/${botId}/qa-folders`).then((r) => r.json());
      setFolders(folderRows);
      setUploadMessage(`${data.count}개의 Q&A를 업로드했습니다.`);
    } catch (error) { setUploadMessage(error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다."); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch(`/api/bots/${botId}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, folder_id: selectedFolder }),
    });
    const newPair = await res.json();
    setPairs([newPair, ...pairs]);
    setQuestion("");
    setAnswer("");
    setAdding(false);
  }

  async function handleDelete(qaId: string) {
    if (!confirm("이 Q&A를 삭제할까요?")) return;
    await fetch(`/api/bots/${botId}/qa/${qaId}`, { method: "DELETE" });
    setPairs(pairs.filter((p) => p.id !== qaId));
  }

  function startEdit(pair: QaPair) {
    setEditingId(pair.id);
    setEditQ(pair.question);
    setEditA(pair.answer);
  }

  async function handleSaveEdit(qaId: string) {
    setSaving(true);
    const res = await fetch(`/api/bots/${botId}/qa/${qaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: editQ, answer: editA }),
    });
    const updated = await res.json();
    setPairs(pairs.map((p) => (p.id === qaId ? updated : p)));
    setEditingId(null);
    setSaving(false);
  }

  return (
    <div className="flex gap-5 items-start">
      <aside className="w-52 shrink-0 bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-gray-500">Q&A 폴더</span>
          <label className="text-xs text-blue-600 cursor-pointer">
            {uploading ? "처리 중" : "엑셀 업로드"}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading} onChange={handleExcelUpload} />
          </label>
        </div>
        <button onClick={() => setSelectedFolder(null)} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm ${selectedFolder === null ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"}`}>
          전체 Q&A <span className="float-right text-xs text-gray-400">{pairs.length}</span>
        </button>
        {folders.map((folder) => (
          <div key={folder.id} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm ${selectedFolder === folder.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"}`}>
            <button onClick={() => setSelectedFolder(folder.id)} className="flex-1 text-left truncate">📁 {folder.name}</button>
            <span className="text-xs text-gray-400">{pairs.filter((p) => p.folder_id === folder.id).length}</span>
            <button onClick={() => handleDeleteFolder(folder.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
          </div>
        ))}
        <form onSubmit={handleAddFolder} className="pt-2 border-t border-gray-100 flex gap-1">
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="새 폴더" className="min-w-0 flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <button disabled={addingFolder || !newFolder.trim()} className="px-2 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50">+</button>
        </form>
        {uploadMessage && <p className="text-xs text-gray-500 px-1 pt-1">{uploadMessage}</p>}
      </aside>
      <div className="flex-1 min-w-0 space-y-6">
      {/* 추가 폼 */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Q&A 추가</h3>
          <span className="text-xs text-gray-400">{selectedFolder ? folders.find((f) => f.id === selectedFolder)?.name : "전체 Q&A"}</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">질문</label>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 배송은 얼마나 걸리나요?"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">답변</label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="예: 주문 후 평균 2~3 영업일 내에 배송됩니다."
            required
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
          <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {adding ? "추가 중 (임베딩 생성)..." : "+ Q&A 추가"}
        </button>
      </form>

      {/* Q&A 목록 */}
      <div className="space-y-3">
        <p className="text-sm text-gray-500">총 {pairs.length}개의 Q&A</p>
        {pairs.length === 0 && (
          <div className="text-center py-10 text-gray-400 bg-white border border-gray-200 rounded-xl">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">아직 Q&A가 없습니다</p>
          </div>
        )}
        {visiblePairs.map((pair) => (
          <div key={pair.id} className="bg-white border border-gray-200 rounded-xl p-4">
            {editingId === pair.id ? (
              <div className="space-y-2">
                <input
                  value={editQ}
                  onChange={(e) => setEditQ(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <textarea
                  value={editA}
                  onChange={(e) => setEditA(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(pair.id)}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "저장"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 text-gray-600 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      <span className="text-blue-500 mr-1">Q.</span>
                      {pair.question}
                    </p>
                    <p className="mt-1.5 text-sm text-gray-600">
                      <span className="text-green-600 mr-1">A.</span>
                      {pair.answer}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(pair)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(pair.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
