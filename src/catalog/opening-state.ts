export type KitchenHour = {
  /** 1 = Monday … 7 = Sunday */
  dayOfWeek: number;
  /** "HH:mm", Istanbul time */
  opensAt: string;
  /** "HH:mm", exclusive, after opensAt (no slots across midnight) */
  closesAt: string;
};

export type OpeningState = { isOpenNow: boolean; opensAt: Date | null };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const istanbulParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const toMinutes = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Weekday (1 = Monday) and "HH:mm" in Istanbul. */
export function istanbulClock(now: Date): { dayOfWeek: number; time: string } {
  const parts = Object.fromEntries(
    istanbulParts.formatToParts(now).map((part) => [part.type, part.value]),
  );

  return {
    dayOfWeek: WEEKDAY[parts.weekday],
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Open now, or when it opens next (within a week). A paused kitchen has no
 * "next opening": the cook resumes it by hand.
 */
export function openingState(
  hours: KitchenHour[],
  isPaused: boolean,
  now: Date,
): OpeningState {
  const { dayOfWeek, time } = istanbulClock(now);
  const minute = toMinutes(time);

  const isOpenNow =
    !isPaused &&
    hours.some(
      (slot) =>
        slot.dayOfWeek === dayOfWeek &&
        toMinutes(slot.opensAt) <= minute &&
        minute < toMinutes(slot.closesAt),
    );

  if (isOpenNow || isPaused) {
    return { isOpenNow, opensAt: null };
  }

  // Turkey has no DST, so Istanbul midnight is a fixed distance from `now`.
  const midnight =
    now.getTime() - (now.getTime() % MINUTE_MS) - minute * MINUTE_MS;

  for (let offset = 0; offset <= 7; offset++) {
    const day = ((dayOfWeek - 1 + offset) % 7) + 1;
    const [next] = hours
      .filter((slot) => slot.dayOfWeek === day)
      .map((slot) => toMinutes(slot.opensAt))
      .filter((opens) => offset > 0 || opens > minute)
      .sort((a, b) => a - b);

    if (next !== undefined) {
      return {
        isOpenNow: false,
        opensAt: new Date(midnight + offset * DAY_MS + next * MINUTE_MS),
      };
    }
  }

  return { isOpenNow: false, opensAt: null };
}
