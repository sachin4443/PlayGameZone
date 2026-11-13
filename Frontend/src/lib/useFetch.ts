import { useCallback, useEffect, useState } from 'react';
import type { AxiosInstance } from 'axios';
import { api, errorMessage } from './api';

/** Loads a GET endpoint and exposes loading / error / reload. */
export function useFetch<T>(url: string | null, params?: Record<string, unknown>, client: AxiosInstance = api) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params ?? {});

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const res = await client.get<T>(url, { params: JSON.parse(key) });
      setData(res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [url, key, client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
