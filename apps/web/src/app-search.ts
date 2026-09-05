/** Shareable browser state accepted by every product route. */
export interface AppSearch {
  /** Force HTML previews through the srcDoc transport instead of URL loading. */
  forceInline?: true;
  /** Open the development-only experience survey preview. */
  survey?: 'preview';
}

const TRUTHY_SEARCH_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** Parse the forceInline escape hatch from a raw query string. */
export function parseForceInline(
  search: string | URLSearchParams | null | undefined,
): boolean {
  if (!search) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get('forceInline');
  return value !== null && TRUTHY_SEARCH_VALUES.has(value.trim().toLowerCase());
}

/** Validate and normalize URL state before the route tree exposes it to UI code. */
export function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const validated: AppSearch = {};
  if (
    typeof search.forceInline === 'string'
    && TRUTHY_SEARCH_VALUES.has(search.forceInline.trim().toLowerCase())
  ) {
    validated.forceInline = true;
  }
  if (search.survey === 'preview') validated.survey = 'preview';
  return validated;
}
