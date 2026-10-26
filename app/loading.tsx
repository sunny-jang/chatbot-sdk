export default function Loading() {
  return (
    <div className="workspace-page" role="status" aria-live="polite">
      <div className="workspace-page-heading">
        <div>
          <h1>불러오는 중이에요</h1>
          <p>작업 공간의 최신 정보를 확인하고 있습니다.</p>
        </div>
      </div>
      <div className="workspace-panel workspace-empty">
        <strong>잠시만 기다려 주세요</strong>
        <p>상담과 챗봇 정보를 안전하게 불러오고 있어요.</p>
      </div>
    </div>
  );
}
