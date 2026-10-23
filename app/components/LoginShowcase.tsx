/**
 * Right-hand panel shared by the agency and desk logins: one product statement and a
 * still of the inbox, so the sign-in page already shows what the work looks like.
 */
export default function LoginShowcase({
  variant,
}: {
  variant: "agency" | "desk";
}) {
  const desk = variant === "desk";
  return (
    <aside className="auth-showcase" aria-hidden="true">
      <h2>
        {desk
          ? "고객 문의가 들어오면, 담당자가 바로 이어받습니다."
          : "고객사마다 챗봇을 운영하고, 상담은 한곳에서 처리합니다."}
      </h2>
      <p>
        {desk
          ? "AI가 먼저 답하고, 사람이 필요한 순간에만 상담함으로 넘어옵니다. 대화 맥락과 인계 요약을 보면서 답변하세요."
          : "지식 문서와 Q&A로 챗봇을 만들고 고객 홈페이지에 설치합니다. 대기 중인 상담과 접수된 문의는 업무 홈에서 바로 확인합니다."}
      </p>
      <div className="auth-preview">
        <div className="auth-preview-head">
          <strong>상담함</strong>
          <span>대기 2 · 진행 1</span>
        </div>
        <div className="auth-preview-row">
          <span className="workspace-customer-initial">김</span>
          <div>
            <strong>김서윤</strong>
            <p>달빛 카페 안내 · 토요일 10명 예약이 가능할까요?</p>
          </div>
          <span className="workspace-status waiting">상담 대기</span>
        </div>
        <div className="auth-preview-row">
          <span className="workspace-customer-initial">박</span>
          <div>
            <strong>박지훈</strong>
            <p>초록 상점 안내 · 배송 일정을 알고 싶어요.</p>
          </div>
          <span className="workspace-status waiting">상담 대기</span>
        </div>
        <div className="auth-preview-row">
          <span className="workspace-customer-initial">이</span>
          <div>
            <strong>이도현</strong>
            <p>달빛 카페 안내 · 단체 주문 견적 요청</p>
          </div>
          <span className="workspace-status active">상담 중</span>
        </div>
      </div>
      <div className="auth-facts">
        <div>
          <strong>Q&A · 문서 · URL</strong>
          지식 등록 방식
        </div>
        <div>
          <strong>스크립트 한 줄</strong>
          홈페이지 설치
        </div>
        <div>
          <strong>인계 요약</strong>
          담당자 연결 시 자동 생성
        </div>
      </div>
    </aside>
  );
}
