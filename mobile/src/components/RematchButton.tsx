// Rematch — creates a fresh match from a completed match's config (same
// teams and overs, batting order swapped) and lands on the new umpire
// console. Mirrors the web component (components/RematchButton.tsx) with
// the mobile auth model: the creation response's adminKey goes into the
// device keychain, so whoever tapped it becomes the new match's scorer.

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { track } from '../analytics';
import { createMatch, storeAdminKey } from '../api';
import { creationLocation } from '../location';
import { toast } from './Toast';
import { Btn } from './ui';
import { colors } from '../theme';
import type { PublicState } from '../types';

export default function RematchButton({ state }: { state: PublicState }) {
  const [busy, setBusy] = useState(false);

  // Rematches only come off a finished match (the summary screen renders
  // other states too).
  if (state.status !== 'completed') return null;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const cfg = state.config;
      const body = {
        // Teams as-is — the common player is already in both player lists.
        teams: cfg.teams,
        oversPerInnings: cfg.oversPerInnings,
        // A completed state's battingFirstIndex already reflects any toss,
        // so this is a true swap of who bats first.
        battingFirstIndex: (1 - cfg.battingFirstIndex) as 0 | 1,
        commonPlayer: cfg.commonPlayer ?? null,
        // Same rules too: a boom-boom match rematches as a boom-boom match.
        boomBoom: cfg.boomBoom ?? false,
        // Best-effort coordinates (see src/location.ts) — may ask for
        // permission right here, at the moment of intent.
        location: await creationLocation(),
      };
      const { id, adminKey } = await createMatch(body);
      // The admin key is this device's scoring credential — keep it in the
      // keychain and send it with every event POST.
      await storeAdminKey(id, adminKey);
      track('rematch', { from: state.id, to: id });
      router.push(`/umpire/${id}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Btn
        title={busy ? 'Setting up the rematch…' : 'Rematch'}
        variant="primary"
        busy={busy}
        onPress={start}
      />
      <Text style={styles.sub}>
        Same teams — batting order swapped. Hold a fresh toss from the console if you like.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  sub: {
    marginTop: 8,
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
  },
});
