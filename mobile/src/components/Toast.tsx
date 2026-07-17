// Toasts — a single fixed host rendered once from the root layout, plus a
// module-level toast() any code can call.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow } from '../theme';

export type ToastKind = 'error' | 'ok';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const listeners = new Set<(t: ToastItem) => void>();
let idCounter = 0;

export function toast(message: string, kind: ToastKind = 'error'): void {
  const t: ToastItem = { id: ++idCounter, message, kind };
  for (const l of listeners) l(t);
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (t: ToastItem) => {
      setToasts((cur) => [...cur, t]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
      }, 3500);
      timers.add(timer);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (!toasts.length) return null;
  return (
    <View pointerEvents="none" style={[styles.region, { bottom: insets.bottom + 18 }]}>
      {toasts.map((t) => (
        <View key={t.id} style={[styles.toast, t.kind === 'ok' && styles.ok]}>
          <Text style={styles.text}>{t.message}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  region: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: 8,
    zIndex: 70,
  },
  toast: {
    maxWidth: 420,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...shadow,
  },
  ok: { borderColor: colors.apricotDeep },
  text: {
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
  },
});
