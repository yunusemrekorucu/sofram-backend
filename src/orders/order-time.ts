import { istanbulClock, toMinutes } from '../catalog/opening-state';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** 00:00 Istanbul time of the day `now` falls in (Turkey has no DST). */
export function istanbulDayStart(now: Date): Date {
  const { time } = istanbulClock(now);

  return new Date(
    now.getTime() - (now.getTime() % MINUTE_MS) - toMinutes(time) * MINUTE_MS,
  );
}

/** Monday 00:00 Istanbul time of the week `now` falls in. */
export function istanbulWeekStart(now: Date): Date {
  const { dayOfWeek } = istanbulClock(now);

  return new Date(istanbulDayStart(now).getTime() - (dayOfWeek - 1) * DAY_MS);
}
