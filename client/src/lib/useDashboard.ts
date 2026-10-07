import { useCallback, useEffect, useState } from 'react';
import api from './api';

export interface Integration {
  id: number;
  botUsername: string | null;
  autostoreUrl: string;
  botActive: boolean;
  callbackUrl: string;
  botTokenMask: string | null;
  apiKeyMask: string | null;
  webhookSecret: string;
  startMessage: string | null;
  startImageUrl: string | null;
  lastCallbackAt: string | null;
  lastError: string | null;
}

export interface DashboardData {
  user: { id: number; username: string; email: string; role: string };
  integration: Integration | null;
  stats: { totalOrders: number; successOrders: number; totalRevenue: number; uniqueBuyers: number };
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<DashboardData>('/dashboard');
      setData(res.data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}
