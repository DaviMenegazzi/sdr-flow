import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export interface InstanceItem {
  id: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected';
  phone: string | null;
  provider: string;
  profileName?: string;
  profilePicUrl?: string;
}

interface InstanceContextType {
  activeInstance: string;
  setActiveInstance: (name: string) => void;
  instances: InstanceItem[];
  loading: boolean;
  refreshInstances: () => Promise<void>;
}

const STORAGE_KEY = 'sdr-flow:active-instance';

const InstanceContext = createContext<InstanceContextType>({
  activeInstance: '',
  setActiveInstance: () => {},
  instances: [],
  loading: false,
  refreshInstances: async () => {},
});

export const useInstance = () => useContext(InstanceContext);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [activeInstance, setActiveInstanceState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const setActiveInstance = useCallback((name: string) => {
    const trimmed = (name || '').trim();
    setActiveInstanceState(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem(STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshInstances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/connections/instances');
      if (res.ok) {
        const data = await res.json();
        const list: InstanceItem[] = Array.isArray(data) ? data : [];
        setInstances(list);

        if (list.length > 0) {
          const currentValid = list.some(i => i.name === activeInstance || i.id === activeInstance);
          if (!currentValid || !activeInstance) {
            const firstConnected = list.find(i => i.status === 'connected');
            const fallback = firstConnected ? (firstConnected.name || firstConnected.id) : (list[0]?.name || list[0]?.id || '');
            if (fallback) setActiveInstance(fallback);
          }
        }
      }
    } catch (err) {
      console.error('Falha ao carregar instâncias da Evolution:', err);
    } finally {
      setLoading(false);
    }
  }, [activeInstance, setActiveInstance]);

  useEffect(() => {
    void refreshInstances();
  }, []);

  return (
    <InstanceContext.Provider
      value={{
        activeInstance,
        setActiveInstance,
        instances,
        loading,
        refreshInstances,
      }}
    >
      {children}
    </InstanceContext.Provider>
  );
}
