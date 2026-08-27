import { useEffect, useRef, useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T, prepareForStorage?: (value: T) => unknown) {
  const activeKey = useRef(key);
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved ? JSON.parse(saved) as T : initialValue;
    } catch { return initialValue; }
  });
  useEffect(() => {
    if (activeKey.current !== key) {
      activeKey.current = key;
      try {
        const saved = window.localStorage.getItem(key);
        setValue(saved ? JSON.parse(saved) as T : initialValue);
      } catch { setValue(initialValue); }
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(prepareForStorage ? prepareForStorage(value) : value));
  }, [initialValue, key, prepareForStorage, value]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail;
      if (detail?.key === key) setValue(detail.value);
    };
    window.addEventListener("ocean:persist", receive);
    return () => window.removeEventListener("ocean:persist", receive);
  }, [key]);
  return [value, setValue] as const;
}
