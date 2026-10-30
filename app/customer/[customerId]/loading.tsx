import { Skeleton, SkeletonList } from "@/app/components/Skeleton";

/** 고객사 상담함 화면 공통 자리 표시. 상단 메뉴는 레이아웃이 그대로 보여주고 본문만 바뀐다. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <span className="skeleton-sr">화면을 불러오는 중입니다.</span>
      <div className="skeleton-page-head" aria-hidden="true" style={{ marginTop: 12 }}>
        <Skeleton width={160} height={26} />
        <Skeleton width={300} height={13} />
      </div>
      <div className="cp-panel" aria-hidden="true" style={{ padding: 0 }}>
        <SkeletonList rows={5} label="" />
      </div>
    </div>
  );
}
