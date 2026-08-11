import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ideal AI Chatbot SDK",
  description: "Ideal AI Chatbot SDK Admin Panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={geist.className}>
      <body className="min-h-screen bg-gray-50">
        <div className="flex min-h-screen">
          <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
            <div className="p-5 border-b border-gray-200">
              <h1 className="text-lg font-bold text-gray-900">Ideal AI Chatbot SDK</h1>
              <p className="text-xs text-gray-500 mt-0.5">Admin Panel</p>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              <Link
                href="/"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <span>🤖</span> 챗봇 목록
              </Link>
              <Link
                href="/bots/new"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <span>➕</span> 새 챗봇 만들기
              </Link>
            </nav>
          </aside>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
