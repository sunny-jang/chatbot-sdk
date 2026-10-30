/** 불러오는 동안 실제 화면 모양을 흐리게 보여주는 자리 표시. 스크린리더에는 "불러오는 중"만 읽힌다. */
export function Skeleton({ width = "100%", height = 14, radius, className = "" }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} style={{ width, height, ...(radius !== undefined ? { borderRadius: radius } : {}) }} />;
}

/** 목록 자리 표시: 줄마다 제목 한 줄 + 보조 한 줄. */
export function SkeletonList({ rows = 4, label = "불러오는 중입니다." }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="skeleton-list">
      <span className="skeleton-sr">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width={36} height={36} radius={9} />
          <div className="skeleton-lines">
            <Skeleton width={`${55 - (i % 3) * 10}%`} height={13} />
            <Skeleton width={`${80 - (i % 2) * 18}%`} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 카드·패널 자리 표시: 제목 + 문단 몇 줄. */
export function SkeletonPanel({ lines = 3, label = "불러오는 중입니다.", className = "" }: { lines?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`skeleton-panel ${className}`}>
      <span className="skeleton-sr">{label}</span>
      <Skeleton width="32%" height={18} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "62%" : "100%"} height={12} />
      ))}
    </div>
  );
}

/** 지표 카드 줄(업무 홈·분석 상단) 자리 표시. */
export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-metrics" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton width="45%" height={11} />
          <Skeleton width="30%" height={26} />
        </div>
      ))}
    </div>
  );
}
