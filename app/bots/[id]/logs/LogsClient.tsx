"use client";

import { useState } from "react";
import { ChatLog } from "@/lib/db";

type Session = {
  sessionId: string;
  logs: ChatLog[];
  startedAt: number;
};

function groupBySessions(logs: ChatLog[]): Session[] {
  const map = new Map<string, ChatLog[]>();
  for (const log of logs) {
    const sid = log.session_id ?? "legacy";
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(log);
  }
  return Array.from(map.entries())
    .map(([sessionId, sessionLogs]) => ({
      sessionId,
      logs: sessionLogs,
      startedAt: Number(sessionLogs[0].created_at),
    }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export default function LogsClient({ logs }: { logs: ChatLog[] }) {
  const sessions = groupBySessions(logs);
  const [openSession, setOpenSession] = useState<string | null>(
    sessions[0]?.sessionId ?? null
  );

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-xl">
        <div className="text-3xl mb-2">💬</div>
        <p className="text-sm">아직 대화 기록이 없어요</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-500">총 {sessions.length}개 세션 · {logs.length}건 대화</p>
      </div>

      {sessions.map((session) => {
        const isOpen = openSession === session.sessionId;
        const first = session.logs[0];
        const last = session.logs[session.logs.length - 1];

        return (
          <div key={session.sessionId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Session header */}
            <button
              onClick={() => setOpenSession(isOpen ? null : session.sessionId)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">💬</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(Number(first.created_at) * 1000).toLocaleString("ko-KR")}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {session.logs.length}개 대화 ·{" "}
                    {first.created_at !== last.created_at
                      ? `~${new Date(Number(last.created_at) * 1000).toLocaleTimeString("ko-KR")}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-400 max-w-[200px] truncate hidden sm:block">
                  {first.user_message}
                </p>
                <span className="text-gray-400 text-xs">{isOpen ? "▲" : "▼"}</span>
              </div>
            </button>

            {/* Messages */}
            {isOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {session.logs.map((log) => (
                  <div key={log.id} className="px-5 py-4">
                    <p className="text-xs text-gray-300 mb-3">
                      {new Date(Number(log.created_at) * 1000).toLocaleTimeString("ko-KR")}
                    </p>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <span className="text-xs font-medium text-blue-500 w-10 shrink-0 pt-0.5">사용자</span>
                        <p className="text-sm text-gray-800 leading-relaxed">{log.user_message}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-xs font-medium text-green-500 w-10 shrink-0 pt-0.5">봇</span>
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{log.bot_reply}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
