import { ApiFieldError } from './api-response.type';

/** The boilerplate's error shape: `{ email: 'notFound', address: { district: '…' } }`. */
export type ErrorTree = { [key: string]: string | ErrorTree };

export function flattenErrors(tree: ErrorTree, prefix = ''): ApiFieldError[] {
  const result: ApiFieldError[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const field = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      result.push({ field, message: value });
    } else {
      result.push(...flattenErrors(value, field));
    }
  }

  return result;
}
