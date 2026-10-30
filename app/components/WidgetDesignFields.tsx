"use client";
import {
  DEFAULT_WIDGET_THEME,
  WIDGET_LAUNCHER_TEXT_MAX,
  WIDGET_THEME_RANGES,
  widgetTextColor,
  widgetTheme,
  type WidgetTheme,
} from "@/lib/widget-presentation";

export type WidgetThemeDraft = Required<WidgetTheme>;
/** 저장값(검증 전)을 기본 모양 위에 얹어 편집용 값으로 만듭니다. */
export const widgetThemeDraft = (value: unknown): WidgetThemeDraft => ({
  ...DEFAULT_WIDGET_THEME,
  ...widgetTheme(value),
});

const OPTIONS = {
  position: [
    ["right", "오른쪽 아래"],
    ["left", "왼쪽 아래"],
  ],
  corner: [
    ["sharp", "각지게"],
    ["rounded", "둥글게"],
    ["pill", "아주 둥글게"],
  ],
  launcher: [
    ["circle", "원형 아이콘"],
    ["rounded-square", "둥근 사각 아이콘"],
    ["text", "글자 버튼"],
  ],
  bubble: [
    ["filled", "색 채우기"],
    ["outline", "테두리만"],
  ],
  font: [
    ["system", "기기 기본 글꼴"],
    ["pretendard", "Pretendard"],
  ],
} as const;
const LABELS = {
  position: "위치",
  corner: "모서리",
  launcher: "열기 버튼 모양",
  bubble: "말풍선",
  font: "글꼴",
} as const;

/**
 * 위젯 디자인 입력 묶음. 에이전시(Tailwind)와 고객사 데스크(.cp-*)가 같은 항목을 쓰도록
 * 마크업은 공유하고 클래스만 받습니다.
 */
export default function WidgetDesignFields({
  value,
  color,
  onChange,
  classes,
}: {
  value: WidgetThemeDraft;
  color: string;
  onChange: (next: WidgetThemeDraft) => void;
  classes: { grid: string; label: string; input: string; hint: string };
}) {
  const set = <K extends keyof WidgetThemeDraft>(
    key: K,
    next: WidgetThemeDraft[K],
  ) => onChange({ ...value, [key]: next });
  const number = (key: keyof typeof WIDGET_THEME_RANGES, raw: string) => {
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) return;
    const [min, max] = WIDGET_THEME_RANGES[key];
    set(key, Math.min(max, Math.max(min, Math.round(n))));
  };
  const select = (key: keyof typeof OPTIONS) => (
    <label className={classes.label} key={key}>
      {LABELS[key]}
      <select
        className={classes.input}
        value={value[key]}
        onChange={(e) =>
          set(key, e.target.value as WidgetThemeDraft[typeof key])
        }
      >
        {OPTIONS[key].map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const headerText = widgetTextColor(color);
  return (
    <div className={classes.grid}>
      {select("position")}
      <label className={classes.label}>
        옆 여백 (px)
        <input
          className={classes.input}
          type="number"
          min={0}
          max={120}
          value={value.offsetX}
          onChange={(e) => number("offsetX", e.target.value)}
        />
      </label>
      <label className={classes.label}>
        아래 여백 (px)
        <input
          className={classes.input}
          type="number"
          min={0}
          max={120}
          value={value.offsetY}
          onChange={(e) => number("offsetY", e.target.value)}
        />
      </label>
      {select("corner")}
      {select("launcher")}
      {value.launcher === "text" && (
        <label className={classes.label}>
          버튼 문구
          <input
            className={classes.input}
            value={value.launcherText}
            maxLength={WIDGET_LAUNCHER_TEXT_MAX}
            placeholder="상담하기"
            onChange={(e) => set("launcherText", e.target.value)}
          />
        </label>
      )}
      <label className={classes.label}>
        버튼 크기 ({value.launcherSize}px)
        <input
          type="range"
          min={48}
          max={64}
          step={2}
          value={value.launcherSize}
          onChange={(e) => number("launcherSize", e.target.value)}
        />
      </label>
      {select("bubble")}
      {select("font")}
      <div className={classes.label}>
        헤더 글자색
        <span className={classes.hint}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 20,
              borderRadius: 4,
              marginRight: 6,
              background: color,
              color: headerText,
              fontSize: 11,
              fontWeight: 600,
              verticalAlign: "middle",
            }}
          >
            가
          </span>
          자동 · {headerText === "#ffffff" ? "흰색" : "검정"} (테마 색 밝기에
          맞춰 선택)
        </span>
      </div>
    </div>
  );
}
