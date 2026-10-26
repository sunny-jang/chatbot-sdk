import type { ReactNode } from "react";

/**
 * 고객사 데스크의 초대·활성화·비밀번호 화면이 함께 쓰는 히어로 카드.
 * 왼쪽은 칩 → 제목(둘째 줄 강조) → 메타 → 본문, 오른쪽은 일러스트, 아래는 단계 안내.
 */
export type HeroStep = { title: string; detail: string };

export function AuthHero({
  chip,
  chipIcon = "mail",
  title,
  accent,
  meta,
  children,
  steps,
  art = "envelope",
}: {
  chip: string;
  chipIcon?: "mail" | "key" | "check" | "warn";
  title: string;
  accent?: string;
  meta?: ReactNode;
  children?: ReactNode;
  steps?: HeroStep[];
  art?: "envelope" | "key" | "none";
}) {
  return (
    <main className="cp-hero-page">
      <section className="cp-hero">
        <div className="cp-hero-body">
          <span className="cp-hero-chip">
            <ChipIcon name={chipIcon} />
            {chip}
          </span>
          <h1 className="cp-hero-title">
            {title}
            {accent && (
              <>
                <br />
                <em>{accent}</em>
              </>
            )}
          </h1>
          {meta && <p className="cp-hero-meta">{meta}</p>}
          {children}
        </div>
        {art !== "none" && (
          <div className="cp-hero-art" aria-hidden="true">
            {art === "envelope" ? <EnvelopeArt /> : <KeyArt />}
          </div>
        )}
        {steps && steps.length > 0 && (
          <ol className="cp-hero-steps">
            {steps.map((s, i) => (
              <li key={s.title}>
                <span className="cp-hero-step-no">{i + 1}</span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.detail}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

/** 강조 상자: 초대받은 이메일처럼 한 가지 값을 크게 보여줄 때. */
export function HeroFact({
  label,
  value,
  icon = "mail",
}: {
  label: string;
  value: ReactNode;
  icon?: "mail" | "key" | "check" | "warn";
}) {
  return (
    <div className="cp-hero-fact">
      <span className="cp-hero-fact-icon">
        <ChipIcon name={icon} size={22} />
      </span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function ChipIcon({
  name,
  size = 16,
}: {
  name: "mail" | "key" | "check" | "warn";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "key")
    return (
      <svg {...common}>
        <circle cx="8" cy="15" r="4" />
        <path d="M10.8 12.2 20 3M15 8l2.5 2.5M18 5l2 2" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    );
  if (name === "warn")
    return (
      <svg {...common}>
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4M12 17h.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

/* 일러스트는 브랜드 토큰만 씁니다: 봉투 + 링크 카드 + 체크 배지. */
function EnvelopeArt() {
  return (
    <svg viewBox="0 0 320 260" width="100%" height="100%" role="img">
      <defs>
        <linearGradient id="cpEnvBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cp-primary-soft)" />
          <stop offset="1" stopColor="#f7f9ff" />
        </linearGradient>
        <linearGradient id="cpEnvFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9c9ff" />
          <stop offset="1" stopColor="#8aa4f5" />
        </linearGradient>
      </defs>
      <circle cx="170" cy="130" r="112" fill="url(#cpEnvBg)" />
      <circle cx="46" cy="96" r="14" fill="var(--cp-primary-soft)" />
      <circle cx="286" cy="206" r="10" fill="var(--cp-primary-soft)" />
      <path d="M248 44l10-14M262 62l16-6M232 34l2-18" stroke="var(--cp-primary)" strokeWidth="5" strokeLinecap="round" />
      {/* back flap */}
      <path d="M86 118 170 62l84 56v84a14 14 0 0 1-14 14H100a14 14 0 0 1-14-14v-84Z" fill="#9db1f7" />
      {/* letter */}
      <rect x="110" y="78" width="120" height="118" rx="10" fill="#fff" stroke="#e2e8fb" />
      <path d="M152 136a14 14 0 0 1 0-20l6-6a14 14 0 0 1 20 20l-4 4" stroke="var(--cp-primary)" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M188 118a14 14 0 0 1 0 20l-6 6a14 14 0 0 1-20-20l4-4" stroke="var(--cp-primary)" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* front pocket */}
      <path d="M86 128l84 54 84-54v74a14 14 0 0 1-14 14H100a14 14 0 0 1-14-14v-74Z" fill="url(#cpEnvFront)" />
      <path d="M86 202l70-50M254 202l-70-50" stroke="#7a95ea" strokeWidth="2" />
      {/* check badge */}
      <circle cx="236" cy="200" r="30" fill="#fff" stroke="#e2e8fb" />
      <path d="m222 200 9 9 20-20" stroke="var(--cp-primary)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function KeyArt() {
  return (
    <svg viewBox="0 0 320 260" width="100%" height="100%" role="img">
      <defs>
        <linearGradient id="cpKeyBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cp-primary-soft)" />
          <stop offset="1" stopColor="#f7f9ff" />
        </linearGradient>
      </defs>
      <circle cx="170" cy="130" r="112" fill="url(#cpKeyBg)" />
      <circle cx="50" cy="180" r="12" fill="var(--cp-primary-soft)" />
      <circle cx="290" cy="70" r="9" fill="var(--cp-primary-soft)" />
      {/* shield */}
      <path d="M170 46l72 26v56c0 44-30 76-72 92-42-16-72-48-72-92V72l72-26Z" fill="#9db1f7" />
      <path d="M170 62l56 20v46c0 36-24 62-56 76-32-14-56-40-56-76V82l56-20Z" fill="#fff" stroke="#e2e8fb" />
      {/* keyhole */}
      <circle cx="170" cy="126" r="16" fill="var(--cp-primary)" />
      <path d="M163 136h14l4 28h-22l4-28Z" fill="var(--cp-primary)" />
      <path d="M240 28l8-12M256 44l14-4" stroke="var(--cp-primary)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
