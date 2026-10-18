import { istanbulDayStart, istanbulWeekStart } from './order-time';

describe('istanbulDayStart', () => {
  it('should be Istanbul midnight, 21:00 UTC the day before', () => {
    expect(istanbulDayStart(new Date('2026-10-12T09:30:45.123Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should already be the next day in Istanbul after 21:00 UTC', () => {
    expect(istanbulDayStart(new Date('2026-10-11T22:30:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should keep an exact midnight', () => {
    expect(istanbulDayStart(new Date('2026-10-11T21:00:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });
});

describe('istanbulWeekStart', () => {
  it('should go back to Monday 00:00 Istanbul time', () => {
    // 2026-10-18 is a Sunday; that week began Monday 2026-10-12.
    expect(istanbulWeekStart(new Date('2026-10-18T10:00:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should be the same day on a Monday', () => {
    expect(istanbulWeekStart(new Date('2026-10-12T09:30:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });
});
