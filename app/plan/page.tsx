import Link from "next/link";

const PLANS = [
  {
    name: "스타터",
    price: "49,000",
    desc: "소규모 서비스에 적합",
    features: ["챗봇 1개", "Q&A 봇 지원", "월 1,000건 대화", "위젯 임베드"],
    highlight: false,
  },
  {
    name: "프로",
    price: "129,000",
    desc: "성장하는 비즈니스를 위해",
    features: ["챗봇 5개", "AI 봇 + RAG 문서 검색", "월 10,000건 대화", "위젯 커스터마이징", "대화 기록 열람"],
    highlight: true,
  },
  {
    name: "엔터프라이즈",
    price: "문의",
    desc: "대용량·전용 인프라 필요 시",
    features: ["챗봇 무제한", "전용 서버 구성", "무제한 대화", "전담 기술 지원", "온프레미스 가능"],
    highlight: false,
  },
];

export default function PlanPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white px-6 py-20">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <div className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-400/30 rounded-full text-blue-300 text-xs font-semibold mb-5 tracking-wide">
            PRICING
          </div>
          <h1 className="text-4xl font-extrabold mb-3">플랜 안내</h1>
          <p className="text-white/50 text-lg">서비스 규모에 맞는 플랜을 선택하세요</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 border ${
                plan.highlight
                  ? "bg-blue-600/20 border-blue-500/50 ring-1 ring-blue-500/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-blue-300 bg-blue-500/20 px-2.5 py-1 rounded-full inline-block mb-3">
                  추천
                </div>
              )}
              <h2 className="text-xl font-bold mb-1">{plan.name}</h2>
              <p className="text-white/40 text-sm mb-4">{plan.desc}</p>
              <div className="text-3xl font-extrabold mb-6">
                {plan.price === "문의" ? plan.price : (
                  <>
                    {plan.price}
                    <span className="text-base font-normal text-white/40">원/월</span>
                  </>
                )}
              </div>
              <ul className="space-y-2.5 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/70">
                    <span className="text-blue-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="mailto:contact@idealai.kr"
                className={`block text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {plan.price === "문의" ? "문의하기" : "도입 문의"}
              </a>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link href="/demo" className="text-sm text-white/40 hover:text-white/70 transition-colors">
            ← 데모로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
