"use client";

import { useState } from "react";

type Doc = {
  id: string;
  bot_id: string;
  title: string;
  content: string;
  created_at: number;
};

export default function DocsManager({
  botId,
  initialDocs,
}: {
  botId: string;
  initialDocs: Doc[];
}) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      const doc = await res.json();
      setDocs((prev) => [doc, ...prev]);
      setTitle("");
      setContent("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(docId: string) {
    await fetch(`/api/bots/${botId}/docs/${docId}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      >
        <h3 className="font-semibold text-gray-900 text-sm">문서 추가</h3>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="문서 제목 (예: 회사 소개, 환불 정책)"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="문서 내용을 입력하세요. 이 내용을 바탕으로 AI가 답변합니다."
          required
          rows={6}
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
      {docs.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white border border-gray-200 rounded-xl">
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm">등록된 문서가 없어요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="text-lg">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{doc.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {doc.content.length.toLocaleString()}자 ·{" "}
                    {new Date(Number(doc.created_at) * 1000).toLocaleDateString("ko-KR")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {expandedId === doc.id ? "접기" : "내용 보기"}
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>
              {expandedId === doc.id && (
                <div className="px-5 pb-4 border-t border-gray-100">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed mt-3 max-h-60 overflow-y-auto">
                    {doc.content}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
