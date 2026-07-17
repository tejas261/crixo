// Mirrors the web's prefers-reduced-motion handling: animated components
// check this and swap instantly instead of animating.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (mounted) setReduced(Boolean(v)); })
      .catch(() => { /* assume motion is fine */ });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      setReduced(Boolean(v));
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
