import { istanbulClock, openingState } from './opening-state';

const MONDAY = [
  { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
  { dayOfWeek: 1, opensAt: '17:00', closesAt: '21:00' },
];

describe('istanbulClock', () => {
  it('should report Istanbul weekday and time', () => {
    expect(istanbulClock(new Date('2026-10-12T09:30:00Z'))).toEqual({
      dayOfWeek: 1,
      time: '12:30',
    });
  });

  it('should already be Monday in Istanbul while it is Sunday in UTC', () => {
    expect(istanbulClock(new Date('2026-10-11T22:30:00Z'))).toEqual({
      dayOfWeek: 1,
      time: '01:30',
    });
  });

  it('should write midnight as 00, not 24', () => {
    expect(istanbulClock(new Date('2026-10-11T21:00:00Z')).time).toBe('00:00');
  });
});

describe('openingState', () => {
  it('should be open inside a slot', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T09:30:00Z')),
    ).toEqual({ isOpenNow: true, opensAt: null });
  });

  it('should treat closesAt as exclusive', () => {
    const state = openingState(MONDAY, false, new Date('2026-10-12T11:00:00Z'));
    expect(state.isOpenNow).toBe(false);
  });

  it('should point at the next slot the same day, on the minute', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T12:00:30Z')),
    ).toEqual({ isOpenNow: false, opensAt: new Date('2026-10-12T14:00:00Z') });
  });

  it('should wrap to the same weekday next week', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T19:00:00Z')),
    ).toEqual({ isOpenNow: false, opensAt: new Date('2026-10-19T08:00:00Z') });
  });

  it('should be closed with no next opening while paused', () => {
    expect(
      openingState(MONDAY, true, new Date('2026-10-12T09:30:00Z')),
    ).toEqual({ isOpenNow: false, opensAt: null });
  });

  it('should be closed with no next opening without hours', () => {
    expect(openingState([], false, new Date('2026-10-12T09:30:00Z'))).toEqual({
      isOpenNow: false,
      opensAt: null,
    });
  });
});
