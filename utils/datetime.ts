export interface LocalDateTimeParts {
  date: string;
  time: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export const deviceTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
};

export const parseLocalDateTime = (date: string, time: string): Date | null => {
  const dateMatch = DATE_PATTERN.exec(date.trim());
  const timeMatch = TIME_PATTERN.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59) return null;

  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes
  ) {
    return null;
  }

  return parsed;
};

export const localPartsToUtcIso = (date: string, time: string): string | null => {
  if (!date.trim() && !time.trim()) return null;
  const parsed = parseLocalDateTime(date, time);
  return parsed ? parsed.toISOString() : null;
};

export const utcIsoToLocalParts = (iso: string | null | undefined): LocalDateTimeParts => {
  if (!iso) return { date: '', time: '' };

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };

  const pad = (value: number) => String(value).padStart(2, '0');

  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
};

export const isPartiallyFilled = (date: string, time: string): boolean => {
  const hasDate = !!date.trim();
  const hasTime = !!time.trim();
  return hasDate !== hasTime;
};

export const formatUtcPreview = (iso: string | null): string => {
  if (!iso) return 'Not set';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

export interface ScheduleWindow {
  startsAt: string | null;
  endsAt: string | null;
}

export type ScheduleError =
  | 'invalid_start'
  | 'invalid_end'
  | 'incomplete_start'
  | 'incomplete_end'
  | 'end_before_start'
  | null;

export const validateScheduleWindow = (
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
): { error: ScheduleError; window: ScheduleWindow } => {
  const empty = { startsAt: null, endsAt: null };

  if (isPartiallyFilled(startDate, startTime)) {
    return { error: 'incomplete_start', window: empty };
  }
  if (isPartiallyFilled(endDate, endTime)) {
    return { error: 'incomplete_end', window: empty };
  }

  const hasStart = !!startDate.trim();
  const hasEnd = !!endDate.trim();

  const startsAt = hasStart ? localPartsToUtcIso(startDate, startTime) : null;
  if (hasStart && !startsAt) return { error: 'invalid_start', window: empty };

  const endsAt = hasEnd ? localPartsToUtcIso(endDate, endTime) : null;
  if (hasEnd && !endsAt) return { error: 'invalid_end', window: empty };

  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: 'end_before_start', window: empty };
  }

  return { error: null, window: { startsAt, endsAt } };
};

export const SCHEDULE_ERROR_MESSAGES: Record<Exclude<ScheduleError, null>, string> = {
  invalid_start: 'The start needs a real date (YYYY-MM-DD) and time (HH:MM)',
  invalid_end: 'The end needs a real date (YYYY-MM-DD) and time (HH:MM)',
  incomplete_start: 'Enter both a start date and a start time, or leave both empty',
  incomplete_end: 'Enter both an end date and an end time, or leave both empty',
  end_before_start: 'The end must be later than the start',
};
