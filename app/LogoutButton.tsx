"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton() {
  async function handleLogout() {
    // signOut 직후 App Router의 캐시된 로그인 레이아웃이 잠깐 남지 않도록
    // 클라이언트 라우팅 대신 전체 문서 이동으로 공개 루트를 다시 로드합니다.
    await signOut({ redirect: false });
    window.location.replace("/");
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 rounded-lg hover:bg-red-50 transition-colors w-full text-left"
    >
      <span>🚪</span> 로그아웃
    </button>
  );
}
