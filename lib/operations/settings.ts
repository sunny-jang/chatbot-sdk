export type RequestSettings = {
  quote: boolean;
  consultation: boolean;
  company: boolean;
  contact: "either" | "email" | "phone";
  consentText: string;
  consentVersion: string;
  retentionDays: number;
};
export const defaultRequestSettings: RequestSettings = {
  quote: false,
  consultation: false,
  company: true,
  contact: "either",
  consentText: "",
  consentVersion: "",
  retentionDays: 90,
};
export function requestSettings(value: unknown): RequestSettings {
  const data =
    value && typeof value === "object"
      ? (value as Partial<RequestSettings>)
      : {};
  return { ...defaultRequestSettings, ...data };
}
