'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface UsePollingOptions<T> {
  /** Async function that fetches data */
  fetchFn: () => Promise<T>;
  /** Polling interval in milliseconds (default: 3000) */
  intervalMs?: number;
  /** Whether polling is enabled (default: true) */
  enabled?: boolean;
}

export interface UsePollingResult<T> {
  /** The latest successfully fetched data */
  data: T | null;
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** The latest error (null if last request succeeded) */
  error: Error | null;
  /** Count of consecutive fetch failures */
  consecutiveErrorCount: number;
  /** Whether to show a connection issue banner (true after 3 consecutive failures) */
  showConnectionBanner: boolean;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
}

export function usePolling<T>(options: UsePollingOptions<T>): UsePollingResult<T> {
  const { fetchFn, intervalMs = 3000, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [consecutiveErrorCount, setConsecutiveErrorCount] = useState<number>(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchFnRef = useRef(fetchFn);

  // Keep fetchFn ref up-to-date to avoid stale closures
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  const doFetch = useCallback(async () => {
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
      setConsecutiveErrorCount(0);
    } catch (err) {
      const fetchError = err instanceof Error ? err : new Error(String(err));
      setError(fetchError);
      setConsecutiveErrorCount((prev) => prev + 1);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Fetch immediately on mount / when enabled changes
    doFetch();

    // Start interval polling
    intervalRef.current = setInterval(doFetch, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, intervalMs, doFetch]);

  const refetch = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  return {
    data,
    isLoading,
    error,
    consecutiveErrorCount,
    showConnectionBanner: consecutiveErrorCount >= 3,
    refetch,
  };
}
