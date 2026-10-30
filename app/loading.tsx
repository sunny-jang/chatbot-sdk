import { Skeleton, SkeletonList, SkeletonMetrics } from "./components/Skeleton";

/** 에이전시 화면 공통 자리 표시: 제목 → 지표 줄 → 목록 패널. 실제 화면과 같은 틀이라 바뀔 때 덜컹이지 않는다. */
export default function Loading() {
  return (
    <div className="workspace-page" role="status" aria-live="polite">
      <span className="skeleton-sr">화면을 불러오는 중입니다.</span>
      <div className="skeleton-page-head" aria-hidden="true">
        <Skeleton width={180} height={26} />
        <Skeleton width={320} height={13} />
      </div>
      <SkeletonMetrics />
      <div className="workspace-panel" aria-hidden="true">
        <SkeletonList rows={5} label="" />
      </div>
    </div>
  );
}
