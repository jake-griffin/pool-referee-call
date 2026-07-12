/**
 * Returns the number of whole seconds elapsed since the given ISO 8601 timestamp.
 * Returns 0 if the timestamp is in the future.
 */
export function elapsedSeconds(isoTimestamp: string): number {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  return Math.max(0, Math.floor(diff / 1000));
}
