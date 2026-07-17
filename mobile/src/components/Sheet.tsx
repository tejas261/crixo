// Bottom sheet dialog on RN Modal. Needs-driven sheets pass no onDismiss —
// the backdrop and Android back button then do nothing, and the sheet stays
// until its need is satisfied (each carries its own Undo footer as the
// escape hatch, like the web console).

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ToastHost from './Toast';
import { colors, fonts } from '../theme';

interface SheetProps {
  open: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}

export default function Sheet({ open, onDismiss, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onDismiss ?? (() => { /* needs-driven: not dismissible */ })}
    >
      <View style={styles.backdropWrap}>
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          accessibilityLabel={onDismiss ? 'Close' : undefined}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom, maxHeight: height * 0.85 }]}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
        {/* RN Modals sit above the root toast host — mirror it in here so
            error toasts stay visible while a sheet is open. */}
        <ToastHost />
      </View>
    </Modal>
  );
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function SheetSub({ children }: { children: ReactNode }) {
  return <Text style={styles.sub}>{children}</Text>;
}

const styles = StyleSheet.create({
  backdropWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 46, 30, 0.35)', // warm scrim
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 18,
    paddingHorizontal: 16,
  },
  scroll: { flexGrow: 0 },
  content: { paddingBottom: 4 },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
    marginBottom: 4,
  },
  sub: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 12,
  },
});
