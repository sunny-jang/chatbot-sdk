import { Skeleton, SkeletonList } from "@/app/components/Skeleton";

/** 챗봇 화면(설정·문서·Q&A·로그·분석) 공통 자리 표시: 머리말 → 탭 → 본문 패널. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <span className="skeleton-sr">챗봇 화면을 불러오는 중입니다.</span>
      <header className="bot-header" aria-hidden="true">
        <Skeleton width={220} height={12} />
        <div className="bot-identity">
          <Skeleton width={44} height={44} radius={12} />
          <div style={{ display: "grid", gap: 8, flex: 1 }}>
            <Skeleton width={200} height={22} />
            <Skeleton width={140} height={12} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
          {[56, 64, 52, 70, 48, 60].map((w, i) => (
            <Skeleton key={i} width={w} height={14} />
          ))}
        </div>
      </header>
      <div className="workspace-panel" aria-hidden="true" style={{ marginTop: 20 }}>
        <SkeletonList rows={5} label="" />
      </div>
    </div>
  );
}
