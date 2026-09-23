import { useEffect, useState } from 'react';

/** Keeps an element mounted while its exit animation plays. */
export function usePresence(isOpen: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, exitMs]);
  return { mounted, closing: mounted && !isOpen };
}
