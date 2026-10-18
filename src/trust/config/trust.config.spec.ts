import trustConfig from './trust.config';

const KEYS = [
  'REVIEW_WINDOW_DAYS',
  'ISSUE_WINDOW_HOURS',
  'MESSAGING_WINDOW_HOURS',
  'SUPPORT_EMAIL',
];

describe('trustConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    KEYS.forEach((key) => delete process.env[key]);
    process.env.SUPPORT_EMAIL = 'destek@sofram.local';
  });

  afterAll(() => {
    process.env = saved;
  });

  it('should default to 7 days, 48 hours and 24 hours', () => {
    expect(trustConfig()).toEqual({
      reviewWindowDays: 7,
      issueWindowHours: 48,
      messagingWindowHours: 24,
      supportEmail: 'destek@sofram.local',
    });
  });

  it('should read the environment', () => {
    process.env.REVIEW_WINDOW_DAYS = '14';
    process.env.ISSUE_WINDOW_HOURS = '72';
    process.env.MESSAGING_WINDOW_HOURS = '12';

    expect(trustConfig()).toMatchObject({
      reviewWindowDays: 14,
      issueWindowHours: 72,
      messagingWindowHours: 12,
    });
  });

  it('should require a support address', () => {
    delete process.env.SUPPORT_EMAIL;

    expect(() => trustConfig()).toThrow();
  });

  it('should refuse out-of-range windows', () => {
    process.env.REVIEW_WINDOW_DAYS = '0';

    expect(() => trustConfig()).toThrow();
  });
});
