import { ApiFieldError } from './api-response.type';

/** The boilerplate's error shape: `{ email: 'notFound', address: { district: '…' } }`. */
export type ErrorTree = { [key: string]: string | ErrorTree };

export function flattenErrors(tree: ErrorTree, prefix = ''): ApiFieldError[] {
  const result: ApiFieldError[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const field = prefix ? `${prefix}.${key}` : key;

    // Thrown error bodies are untyped at runtime: only recurse into real
    // objects and stringify any other leaf (null, numbers, booleans).
    if (value !== null && typeof value === 'object') {
      result.push(...flattenErrors(value, field));
    } else {
      result.push({ field, message: String(value) });
    }
  }

  return result;
}
