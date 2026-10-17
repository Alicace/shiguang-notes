export const UPDATE_INTERVAL_STORAGE_KEY = "shiguang.update.intervalHours";
export const UPDATE_LAST_CHECK_STORAGE_KEY = "shiguang.update.lastCheckedAt";

export type UpdateIntervalHours = 0 | 1 | 6 | 24 | 72;

export const UPDATE_INTERVAL_OPTIONS: Array<{
  label: string;
  value: UpdateIntervalHours;
}> = [
  { label: "每次启动", value: 0 },
  { label: "每小时", value: 1 },
  { label: "每 6 小时", value: 6 },
  { label: "每天", value: 24 },
  { label: "每 3 天", value: 72 },
];

export const DEFAULT_UPDATE_INTERVAL_HOURS: UpdateIntervalHours = 6;

export function readUpdateInterval(): UpdateIntervalHours {
  if (typeof localStorage === "undefined") return DEFAULT_UPDATE_INTERVAL_HOURS;
  const stored = localStorage.getItem(UPDATE_INTERVAL_STORAGE_KEY);
  if (stored === null) return DEFAULT_UPDATE_INTERVAL_HOURS;
  const value = Number(stored);
  return UPDATE_INTERVAL_OPTIONS.some((option) => option.value === value)
    ? (value as UpdateIntervalHours)
    : DEFAULT_UPDATE_INTERVAL_HOURS;
}

export function writeUpdateInterval(value: UpdateIntervalHours): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UPDATE_INTERVAL_STORAGE_KEY, String(value));
}

export function readLastUpdateCheck(): number {
  if (typeof localStorage === "undefined") return 0;
  const value = Number(localStorage.getItem(UPDATE_LAST_CHECK_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function markUpdateChecked(now = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UPDATE_LAST_CHECK_STORAGE_KEY, String(now));
}

export function isUpdateCheckDue(
  intervalHours: UpdateIntervalHours,
  lastCheckedAt: number,
  now = Date.now(),
): boolean {
  if (intervalHours === 0) return true;
  return now - lastCheckedAt >= intervalHours * 60 * 60 * 1000;
}
