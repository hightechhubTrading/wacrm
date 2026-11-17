import { useEffect, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
export function useForeground() {
  const [foreground, setForeground] = useState(
    document.visibilityState !== 'hidden'
  );
  useEffect(() => {
    const visibility = () =>
      setForeground(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', visibility);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', (s) =>
          setForeground(s.isActive && document.visibilityState !== 'hidden')
        )
      : null;
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      void listener?.then((l) => l.remove());
    };
  }, []);
  return foreground;
}
