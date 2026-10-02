import type { ChecklistReminder } from "./types";

export function reminderStatus(reminder: ChecklistReminder): string {
  const time = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(reminder.scheduledFor));
  switch (reminder.state) {
    case "pending":
      return `scheduling ${time}…`;
    case "overdue":
      return `overdue since ${time}`;
    case "permission-denied":
      return "notifications off";
    case "scheduling-failed":
      return reminder.lastError ?? "macOS did not schedule this reminder";
    default:
      return `reminds ${time}`;
  }
}

export function nextHourValue(): string {
  const value = new Date();
  value.setHours(value.getHours() + 1, 0, 0, 0);
  return localDateTimeValue(value);
}

export function localDateTimeValue(value: Date): string {
  const part = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(
    value.getHours(),
  )}:${part(value.getMinutes())}`;
}

export function reminderIsoFromLocalValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid reminder date and time.");
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = parts;
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  ) {
    throw new Error("That local time does not exist. Choose another time.");
  }
  if (local.getTime() <= Date.now()) throw new Error("Choose a reminder time in the future.");
  return local.toISOString();
}
