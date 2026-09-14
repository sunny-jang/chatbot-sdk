// 상담원 연결 가능 시간(운영 시간) 설정과 판별.
// 서버(상담 요청 거부, 버튼 노출 판단)와 설정 화면(미리보기)에서 함께 사용하므로 서버 전용 의존성을 두지 않습니다.

export type SupportHours = {
  enabled: boolean;
  /** 0=일, 1=월, … 6=토 */
  days: number[];
  /** HH:mm (한국 표준시) */
  start: string;
  /** HH:mm (한국 표준시). start보다 이르면 자정을 넘기는 야간 운영으로 처리합니다. */
  end: string;
};

export const SUPPORT_HOURS_TIME_ZONE = "Asia/Seoul";

export const DEFAULT_SUPPORT_HOURS: SupportHours = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function normalizeSupportHours(value: unknown): SupportHours | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SupportHours>;
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : DEFAULT_SUPPORT_HOURS.days;
  const start = typeof raw.start === "string" && TIME_PATTERN.test(raw.start) ? raw.start : DEFAULT_SUPPORT_HOURS.start;
  const end = typeof raw.end === "string" && TIME_PATTERN.test(raw.end) ? raw.end : DEFAULT_SUPPORT_HOURS.end;
  return { enabled: Boolean(raw.enabled), days, start, end };
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 한국 표준시 기준 요일(0=일)과 자정 이후 경과 분 */
function nowInSupportTimeZone(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SUPPORT_HOURS_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** 운영 시간 설정이 꺼져 있거나 없으면 항상 연결 가능으로 봅니다. */
export function isWithinSupportHours(hours: SupportHours | null | undefined, now = new Date()) {
  if (!hours?.enabled) return true;
  if (hours.days.length === 0) return false;
  const { day, minutes } = nowInSupportTimeZone(now);
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === end) return hours.days.includes(day); // 선택한 요일 24시간
  if (start < end) return hours.days.includes(day) && minutes >= start && minutes < end;
  // 야간 운영(예: 22:00~02:00): 시작 요일의 밤 + 다음 날 새벽
  const previousDay = (day + 6) % 7;
  return (hours.days.includes(day) && minutes >= start) || (hours.days.includes(previousDay) && minutes < end);
}

function formatDays(days: number[]) {
  const key = [...days].sort().join(",");
  if (key === "0,1,2,3,4,5,6") return "매일";
  if (key === "1,2,3,4,5") return "평일";
  if (key === "0,6") return "주말";
  // 월요일부터 표시합니다.
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => DAY_LABELS[day]).join("·");
}

/** 예: "평일 09:00~18:00". 설정이 꺼져 있으면 null */
export function formatSupportHours(hours: SupportHours | null | undefined) {
  if (!hours?.enabled) return null;
  if (hours.days.length === 0) return "상담원 연결 가능 요일 없음";
  const time = hours.start === hours.end ? "24시간" : `${hours.start}~${hours.end}`;
  return `${formatDays(hours.days)} ${time}`;
}

export type SupportStatusReason = "unattended_mode" | "forced" | "outside_hours";

export type SupportStatus = {
  /** 지금 새 상담원 연결을 받을 수 있는지 */
  live: boolean;
  reason: SupportStatusReason | null;
  label: string;
  hoursText: string | null;
};

/**
 * 챗봇의 현재 상담 운영 상태. 위젯 버튼 노출, 상담 요청 허용, 설정 화면 상태 표시가 모두 이 결과를 사용합니다.
 * 우선순위: 무인 상담 모드 → 강제 무인 운영 → 운영 시간 외 → 상담원 연결 가능
 */
export function getSupportStatus(
  bot: { support_mode?: string | null; force_unattended?: boolean | null; support_hours?: unknown },
  now = new Date(),
): SupportStatus {
  const hours = normalizeSupportHours(bot.support_hours);
  const hoursText = formatSupportHours(hours);
  if (bot.support_mode !== "hybrid") {
    return { live: false, reason: "unattended_mode", label: "24시간 무인 상담 모드", hoursText };
  }
  if (bot.force_unattended) {
    return { live: false, reason: "forced", label: "무인 운영 중 · 강제 전환", hoursText };
  }
  if (!isWithinSupportHours(hours, now)) {
    return { live: false, reason: "outside_hours", label: `무인 운영 중 · 운영 시간 외${hoursText ? ` (${hoursText})` : ""}`, hoursText };
  }
  return { live: true, reason: null, label: "상담원 연결 가능", hoursText };
}
