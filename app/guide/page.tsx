export const dynamic = "force-dynamic";

const steps = [
  {
    step: "01",
    id: "step-01",
    title: "챗봇 만들기",
    icon: "🤖",
    color: "#6949f4",
    items: [
      "홈 화면에서 '새 챗봇 만들기' 클릭",
      "봇 이름, 유형(AI봇 / Q&A봇) 선택",
      "AI봇: 시스템 프롬프트로 봇의 역할·말투 지정",
      "Q&A봇: 질문-답변 쌍을 직접 등록, GPT 호출 없이 응답",
    ],
  },
  {
    step: "02",
    id: "step-02",
    title: "문서 업로드",
    icon: "📄",
    color: "#0ea5e9",
    items: [
      "봇 → 문서 관리에서 폴더 구조로 문서 정리 가능",
      "파일 업로드: PDF, DOCX, HWP, HWPX, HTML, TXT, MD 지원",
      "폴더 업로드: 디렉토리 구조 그대로 가져오기",
      "ZIP 파일 업로드 시 내부 파일 자동 추출",
      "업로드된 문서는 자동으로 임베딩(벡터화)되어 검색에 활용",
    ],
  },
  {
    step: "03",
    id: "step-03",
    title: "테스트",
    icon: "▶",
    color: "#8b5cf6",
    items: [
      "봇 → 테스트 메뉴에서 실제 동작 확인",
      "답변 아래에 참조된 문서와 유사도(%) 표시",
      "문서가 잘 검색되는지 확인 후 문서 내용 보완",
      "대화 초기화 버튼으로 새 세션 시작",
    ],
  },
  {
    step: "04",
    id: "step-04",
    title: "위젯 설정",
    icon: "🎨",
    color: "#f054c1",
    items: [
      "봇 → 설정에서 위젯 제목, 색상, 시작 인사말 변경 가능",
      "색상은 챗봇 페이지 전체 테마에도 반영됨",
      "설정 저장 시 임베드된 위젯에 즉시 반영",
    ],
  },
  {
    step: "05",
    id: "step-05",
    title: "웹사이트에 임베드",
    icon: "🔗",
    color: "#10b981",
    items: [
      "패키지 프로젝트: npm install ideal-ai-chatbot-sdk 실행",
      "설정 화면의 초기화 코드를 복사해 앱에서 실행",
      "일반 HTML: 설정 페이지 하단의 스크립트 코드 복사",
      "웹사이트 HTML의 </body> 태그 바로 위에 붙여넣기",
      "data-bot-id와 data-endpoint가 자동으로 설정됨",
      "위젯이 우측 하단에 플로팅 버튼으로 표시됨",
    ],
  },
];

const faq = [
  {
    q: "Q&A봇과 AI봇의 차이가 뭔가요?",
    a: "Q&A봇은 등록된 질문-답변 쌍에서 가장 유사한 답변을 반환합니다. OpenAI API를 호출하지 않아 비용이 발생하지 않습니다. AI봇은 업로드된 문서를 참조해 GPT가 답변을 생성합니다.",
  },
  {
    q: "문서를 업로드했는데 봇이 모른다고 해요.",
    a: "문서 유사도 임계값(25%)을 기준으로 검색합니다. 테스트 화면에서 답변 아래 참조 문서가 표시되는지 확인하세요. 표시가 안 된다면 문서 내용이 질문과 의미적으로 가깝지 않은 경우입니다. 문서 제목과 내용을 더 구체적으로 작성해보세요.",
  },
  {
    q: "한 계정에 봇을 몇 개까지 만들 수 있나요?",
    a: "스타터 1개·월 1,000세션, 그로스 3개·월 5,000세션, 프로 5개·월 10,000세션까지 이용할 수 있으며 엔터프라이즈는 계약 시 협의한 한도가 적용됩니다.",
  },
  {
    q: "임베드 코드를 여러 페이지에 넣어도 되나요?",
    a: "네. 같은 코드를 여러 페이지에 넣어도 됩니다. 위젯은 중복 방지 처리가 되어 있어 한 페이지에 여러 번 삽입해도 하나만 표시됩니다.",
  },
];

export default function GuidePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">시작 가이드</h2>
        <p className="text-sm text-gray-500 mt-1">Ideal AI Chatbot SDK를 처음 사용하신다면 순서대로 따라해보세요</p>
      </div>

      {/* Steps */}
      <div className="space-y-4 mb-10">
        {steps.map((s) => (
          <div key={s.step} id={s.id} className="bg-white border border-gray-200 rounded-2xl p-6 scroll-mt-8">
            <div className="flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg shrink-0"
                style={{ backgroundColor: s.color }}
              >
                {s.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold" style={{ color: s.color }}>STEP {s.step}</span>
                  <h3 className="font-semibold text-gray-900">{s.title}</h3>
                </div>
                <ul className="space-y-1.5">
                  {s.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">자주 묻는 질문</h3>
        <div className="space-y-3">
          {faq.map((f, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="font-medium text-gray-900 text-sm mb-2">{f.q}</p>
              <p className="text-sm text-gray-500 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
