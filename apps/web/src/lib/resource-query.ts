/**
 * Append a query fragment to a URL without corrupting one that already carries
 * a query string. Used by the file/preview surfaces to add cache-busting and
 * variant selectors to daemon resource URLs.
 */
export function appendResourceQuery(path: string, query: string): string {
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query.replace(/^[?&]+/, '')}`;
}
