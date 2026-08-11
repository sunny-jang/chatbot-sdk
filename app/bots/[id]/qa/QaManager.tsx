"use client";

import { useState } from "react";

type QaPair = {
  id: string;
  bot_id: string;
  question: string;
  answer: string;
  created_at: number;
};

export default function QaManager({
  botId,
  initialPairs,
}: {
  botId: string;
  initialPairs: QaPair[];
}) {
  const [pairs, setPairs] = useState<QaPair[]>(initialPairs);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch(`/api/bots/${botId}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
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
    <div className="space-y-6">
      {/* 추가 폼 */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      >
        <h3 className="font-semibold text-gray-900">Q&A 추가</h3>
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
        {pairs.map((pair) => (
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
  );
}
