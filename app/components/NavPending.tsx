"use client";
import { useLinkStatus } from "next/link";

/**
 * 메뉴 링크 안에 두는 이동 중 표시. 새 화면이 올 때까지 지금 화면을 그대로 두고,
 * 이동이 0.3초 넘게 걸릴 때만 작은 원이 나타난다(빠른 이동에서는 아무것도 보이지 않는다).
 */
export default function NavPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-pending${pending ? " is-pending" : ""}`} />;
}
