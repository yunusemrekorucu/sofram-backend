const FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/**
 * The search key stored in `searchText` and applied to queries:
 * Turkish-aware lower case without diacritics ("İçli Köfte" → "icli kofte").
 * Done here because Postgres `lower()` gets İ/I wrong outside a tr collation.
 */
export function foldTurkish(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (ch) => FOLD[ch])
    .replace(/\s+/g, ' ')
    .trim();
}

/** `%…%` LIKE pattern for a user query; escapes the user's own wildcards. */
export function likePattern(query: string): string {
  return `%${foldTurkish(query).replace(/[\\%_]/g, '\\$&')}%`;
}
