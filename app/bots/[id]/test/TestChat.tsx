"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

type UsedDoc = { title: string; score: number };
type Message = { role: "user" | "bot"; text: string; usedDocs?: UsedDoc[] };
type Folder = { id: string; name: string };
type QaPair = { id: string; folder_id: string | null; question: string; answer: string };

export default function TestChat({ botId, folders, qaPairs, logoUrl, themeColor }: { botId: string; folders: Folder[]; qaPairs: QaPair[]; logoUrl: string | null; themeColor: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [choiceFolder, setChoiceFolder] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const history = useRef<{ role: string; content: string }[]>([]);
  const sessionId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch(`/api/chat/${botId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.current, sessionId: sessionId.current }),
      });
      const data = await res.json();
      const reply = data.reply || "오류가 발생했습니다.";
      setMessages((prev) => [...prev, { role: "bot", text: reply, usedDocs: data.usedDocs }]);
      history.current = [
        ...history.current,
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ].slice(-20);
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "네트워크 오류가 발생했습니다." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function reset() {
    setMessages([]);
    history.current = [];
    sessionId.current = crypto.randomUUID();
    setChoiceFolder(null);
  }

  function chooseQuestion(pair: QaPair) {
    setChoiceFolder(pair.folder_id);
    setMessages((prev) => [...prev, { role: "user", text: pair.question }, { role: "bot", text: pair.answer }]);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col" style={{ height: "600px" }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between text-white" style={{ background: `linear-gradient(135deg, #ec4899, ${themeColor})` }}>
        <div className="flex items-center gap-2">
          {logoUrl ? <img src={logoUrl} alt="챗봇 로고" className="w-8 h-8 rounded-lg bg-white object-contain" /> : <span className="w-2 h-2 rounded-full bg-green-300"></span>}
          <span className="text-sm font-medium">테스트 채팅</span>
        </div>
        <button
          onClick={reset}
          className="text-xs text-white/70 hover:text-white transition-colors"
        >
          대화 초기화
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-sm">메시지를 보내 챗봇을 테스트해보세요</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                  : "bg-gray-100 text-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.role === "user" ? msg.text : (
                <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-strong:font-semibold prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-200 prose-pre:p-2 prose-pre:rounded">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              )}
            </div>
            {msg.usedDocs && msg.usedDocs.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 max-w-[75%]">
                {msg.usedDocs.map((d, j) => (
                  <span key={j} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-100">
                    <span>📄</span>
                    <span>{d.title}</span>
                    <span className="text-blue-300">{d.score}%</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-400 px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm italic">
              입력 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {qaPairs.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs font-medium text-gray-500 mb-2">선택해서 테스트하기</p>
          <div className="flex flex-wrap gap-2">
            {choiceFolder === null ? (
              folders.length > 0 ? folders.map((folder) => (
                <button key={folder.id} onClick={() => setChoiceFolder(folder.id)} className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-blue-600 text-xs hover:bg-blue-50">
                  {folder.name}
                </button>
              )) : qaPairs.slice(0, 12).map((pair) => (
                <button key={pair.id} onClick={() => chooseQuestion(pair)} className="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 text-xs hover:bg-blue-50 text-left">
                  {pair.question}
                </button>
              ))
            ) : (
              <>
                <button onClick={() => setChoiceFolder(null)} className="px-3 py-1.5 rounded-full bg-gray-200 text-gray-600 text-xs">← 폴더</button>
                {qaPairs.filter((pair) => pair.folder_id === choiceFolder).map((pair) => (
                  <button key={pair.id} onClick={() => chooseQuestion(pair)} className="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 text-xs hover:bg-blue-50 text-left">
                    {pair.question}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요..."
          disabled={loading}
          autoFocus
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          전송
        </button>
      </div>
    </div>
  );
}
