import { foldTurkish, likePattern } from './fold-turkish';

describe('foldTurkish', () => {
  it('should lower-case Turkish capitals correctly', () => {
    expect(foldTurkish('İçli Köfte')).toBe('icli kofte');
    expect(foldTurkish('ISPANAK')).toBe('ispanak');
  });

  it('should fold dotted and dotless i and the diacritics', () => {
    expect(foldTurkish('Mantı')).toBe('manti');
    expect(foldTurkish('MANTI')).toBe('manti');
    expect(foldTurkish('şiş çöğür ünlü')).toBe('sis cogur unlu');
  });

  it('should collapse and trim whitespace', () => {
    expect(foldTurkish('  Ev   usulü\nmantı ')).toBe('ev usulu manti');
  });
});

describe('likePattern', () => {
  it('should wrap the folded query in wildcards', () => {
    expect(likePattern('Köfte')).toBe('%kofte%');
  });

  it("should escape the caller's own wildcards", () => {
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });
});
