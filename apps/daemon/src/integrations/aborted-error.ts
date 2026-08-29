/** Whether a rejection represents an operation the daemon cancelled. */
export function isAbortedOperationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.code === 'ABORT_ERR' || candidate.name === 'AbortError';
}
