// AccountAvatar — the signed-in user's Google profile photo as a small round
// image (core RN <Image>), falling back to a warm initial-letter circle
// (panel-2 face, apricot-ink letter, thin warm border) when there's no
// picture URL or it fails to load (googleusercontent URLs rotate). Mirrors
// the web's .account-avatar / .avatar-fallback.

import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

interface AccountAvatarProps {
  name: string | null | undefined;
  email: string | null | undefined;
  picture: string | null | undefined;
  size: number;
}

export default function AccountAvatar({ name, email, picture, size }: AccountAvatarProps) {
  const [broken, setBroken] = useState(false);
  // A fresh sign-in can swap the URL; give the new one a chance to load.
  useEffect(() => { setBroken(false); }, [picture]);

  const round = { width: size, height: size, borderRadius: size / 2 };
  if (picture && !broken) {
    return (
      <Image
        source={{ uri: picture }}
        style={[styles.photo, round]}
        onError={() => setBroken(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const initial = (name || email || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.fallback, round]}>
      <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.5) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    borderWidth: 1,
    borderColor: colors.line,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  fallbackText: {
    color: colors.apricotInk,
    fontWeight: '700',
  },
});
