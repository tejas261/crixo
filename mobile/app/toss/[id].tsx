// Toss — the pre-match coin toss, run by the umpire. Three staged moments:
// the call (who calls, heads or tails), THE flip (an Animated 3D coin on the
// signature gradient), then the winner's decision. Confirming posts a single
// `toss` event; the engine records it and sets config.battingFirstIndex.
//
// The flip outcome is decided by one crypto-random bit BEFORE the animation
// starts; the rotateX animation just lands on that face. Under reduced
// motion (AccessibilityInfo.isReduceMotionEnabled) the face is revealed
// instantly instead.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { getStoredAdminKey, postMatchEvent, type ApiError } from '../../src/api';
import { useMatch } from '../../src/useMatch';
import { useReducedMotion } from '../../src/useReducedMotion';
import { teamsLine } from '../../src/format';
import { PageBackground, SiteHeader } from '../../src/components/Screen';
import TossLine from '../../src/components/TossLine';
import { toast } from '../../src/components/Toast';
import { Btn, EmptyState, FieldLabel, Hint, Panel, PanelTitle } from '../../src/components/ui';
import { colors, fonts, GRAD, GRAD_END, GRAD_START } from '../../src/theme';
import type { TossCall, TossDecision } from '../../src/types';

type Stage = 'call' | 'flip' | 'result';

const COIN_SIZE = 160;

// The heads face: the Crixo crossed-bats-and-ball motif, ink on the gradient
// (circle omitted — the coin face itself is the gradient badge).
function HeadsGlyph() {
  return (
    <Svg width={104} height={104} viewBox="0 0 48 48">
      <G fill="#4A2B0F">
        <Rect x={21.3} y={12.5} width={5.4} height={27} rx={2.7} transform="rotate(30 24 26)" />
        <Rect x={21.3} y={12.5} width={5.4} height={27} rx={2.7} transform="rotate(-30 24 26)" />
      </G>
      <Circle cx={24} cy={11.6} r={4.7} fill="#C63D08" />
      <Path
        d="M20.9 10.2 a4.4 4.4 0 0 1 6.2 0"
        stroke="#FFF9F0" strokeWidth={1.1} fill="none" strokeLinecap="round"
      />
    </Svg>
  );
}

// The 3D coin. `outcome` null = resting on heads; set = spin and land.
function Coin({ outcome, reduced }: { outcome: TossCall | null; reduced: boolean }) {
  const spin = useRef(new Animated.Value(0)).current; // degrees

  useEffect(() => {
    if (outcome == null) {
      spin.setValue(0);
      return;
    }
    const target = outcome === 'heads' ? 1800 : 1980; // 5 spins -> heads; 5.5 -> tails
    if (reduced) {
      spin.setValue(target);
      return;
    }
    Animated.timing(spin, {
      toValue: target,
      duration: 1600,
      easing: Easing.bezier(0.18, 0.85, 0.28, 1), // fast spins, soft landing
      useNativeDriver: true,
    }).start();
  }, [outcome, reduced, spin]);

  const rotateX = spin.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const rotateXTails = spin.interpolate({ inputRange: [0, 360], outputRange: ['180deg', '540deg'] });

  return (
    <View style={styles.coinWrap}>
      {/* heads face */}
      <Animated.View
        style={[styles.coinFace, { transform: [{ perspective: 900 }, { rotateX }], backfaceVisibility: 'hidden' }]}
      >
        <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.coinFill}>
          <HeadsGlyph />
        </LinearGradient>
      </Animated.View>
      {/* tails face (pre-rotated 180°) */}
      <Animated.View
        style={[styles.coinFace, { transform: [{ perspective: 900 }, { rotateX: rotateXTails }], backfaceVisibility: 'hidden' }]}
      >
        <View style={[styles.coinFill, styles.coinTails]}>
          <Text style={styles.coinT}>T</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function TossScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = typeof id === 'string' ? id : undefined;
  const { state, error } = useMatch(matchId);
  const reduced = useReducedMotion();

  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [keyLoaded, setKeyLoaded] = useState(false);

  const [stage, setStage] = useState<Stage>('call');
  const [callerIndex, setCallerIndex] = useState<0 | 1 | null>(null);
  const [call, setCall] = useState<TossCall | null>(null);
  const [outcome, setOutcome] = useState<TossCall | null>(null);
  const [posting, setPosting] = useState(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    getStoredAdminKey(matchId)
      .then((k) => { if (!cancelled) setAdminKey(k); })
      .finally(() => { if (!cancelled) setKeyLoaded(true); });
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => () => {
    if (flipTimer.current != null) clearTimeout(flipTimer.current);
  }, []);

  const teams = state?.config.teams;
  const winnerIndex: 0 | 1 | null =
    callerIndex != null && call != null && outcome != null
      ? (outcome === call ? callerIndex : (1 - callerIndex) as 0 | 1)
      : null;

  function flip() {
    if (callerIndex == null || call == null || outcome != null) return;
    // The flip happens NOW: one crypto bit decides; the animation just lands.
    const landed: TossCall = (Crypto.getRandomBytes(1)[0] & 1) === 0 ? 'heads' : 'tails';
    setOutcome(landed);
    setStage('flip');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Reveal the result once the spin lands (~1.6s); reduced motion shows
    // the final face instantly, so cut almost straight to the result.
    flipTimer.current = setTimeout(() => setStage('result'), reduced ? 250 : 1750);
  }

  async function confirm(decision: TossDecision) {
    if (posting || !matchId || callerIndex == null || call == null || outcome == null || winnerIndex == null) return;
    setPosting(true);
    try {
      await postMatchEvent(
        matchId,
        { type: 'toss', callerIndex, call, outcome, winnerIndex, decision },
        adminKey,
      );
      router.replace(`/umpire/${matchId}`);
    } catch (err) {
      toast((err as ApiError).message);
      setPosting(false);
    }
  }

  function body() {
    if (error) {
      return (
        <Panel>
          <EmptyState>Couldn&apos;t load this match — {error}. Check the link and refresh.</EmptyState>
        </Panel>
      );
    }
    if (!state || !keyLoaded || !teams) {
      return (
        <Panel>
          <EmptyState>Loading match…</EmptyState>
        </Panel>
      );
    }
    // Toss already recorded (any status): show the result, point at the console.
    if (state.toss) {
      return (
        <Panel>
          <PanelTitle>The toss</PanelTitle>
          <Text style={styles.resultText}>
            <Text style={styles.resultStrong}>{teams[state.toss.winnerIndex].name}</Text> won the toss
          </Text>
          <TossLine state={state} center />
          {state.status === 'setup' && (
            <Hint center style={{ marginTop: 8 }}>
              Recorded it wrong? Undo it from the console and toss again.
            </Hint>
          )}
          <View style={{ marginTop: 18 }}>
            <Btn title="Back to the console" variant="primary" onPress={() => router.replace(`/umpire/${matchId}`)} />
          </View>
        </Panel>
      );
    }
    if (state.status !== 'setup') {
      return (
        <Panel>
          <EmptyState>The match has moved on.</EmptyState>
          <Btn title="Back to the console" onPress={() => router.replace(`/umpire/${matchId}`)} />
        </Panel>
      );
    }
    if (!adminKey) {
      return (
        <Panel>
          <EmptyState>
            Only the umpire runs the toss — this device holds no scoring key for
            this match. Paste it on the console screen, or follow the match on
            the live view.
          </EmptyState>
          <View style={{ gap: 8 }}>
            <Btn title="Open the console" onPress={() => router.replace(`/umpire/${matchId}`)} />
            <Btn title="Watch live" variant="quiet" onPress={() => router.replace(`/m/${matchId}`)} />
          </View>
        </Panel>
      );
    }

    return (
      <Panel>
        <PanelTitle>The toss</PanelTitle>

        <Coin outcome={outcome} reduced={reduced} />

        {stage === 'call' && (
          <View style={{ gap: 4 }}>
            <FieldLabel>Who calls?</FieldLabel>
            <View style={styles.row}>
              {teams.map((t, idx) => (
                <Btn
                  key={idx}
                  title={t.name}
                  pressed={callerIndex === idx}
                  onPress={() => setCallerIndex(idx as 0 | 1)}
                  style={styles.rowBtn}
                  small
                />
              ))}
            </View>
            <FieldLabel>Their call</FieldLabel>
            <View style={styles.row}>
              {(['heads', 'tails'] as const).map((c) => (
                <Btn
                  key={c}
                  title={c === 'heads' ? 'Heads' : 'Tails'}
                  pressed={call === c}
                  onPress={() => setCall(c)}
                  style={styles.rowBtn}
                />
              ))}
            </View>
            <View style={{ marginTop: 18 }}>
              <Btn
                title="Flip the coin"
                variant="primary"
                disabled={callerIndex == null || call == null}
                onPress={flip}
              />
            </View>
          </View>
        )}

        {stage === 'flip' && (
          <Hint center>The coin is in the air…</Hint>
        )}

        {stage === 'result' && winnerIndex != null && callerIndex != null && (
          <View style={{ gap: 4 }}>
            <Text style={styles.resultText}>
              <Text style={styles.resultStrong}>{teams[winnerIndex].name}</Text> won the toss
            </Text>
            <Hint center>
              It&apos;s {outcome} — {teams[callerIndex].name} called {call}.{' '}
              {teams[winnerIndex].name} choose:
            </Hint>
            <View style={[styles.row, { marginTop: 12 }]}>
              <Btn
                title="Bat first" variant="primary" disabled={posting}
                onPress={() => confirm('bat')} style={styles.rowBtn}
              />
              <Btn
                title="Bowl first" variant="primary" disabled={posting}
                onPress={() => confirm('bowl')} style={styles.rowBtn}
              />
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <Btn title="Skip the toss" variant="quiet" onPress={() => router.replace(`/umpire/${matchId}`)} />
        </View>
      </Panel>
    );
  }

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SiteHeader
          teams={teamsLine(state)}
          right={<Btn title="Console" variant="quiet" onPress={() => router.replace(`/umpire/${matchId}`)} />}
        />
        <View style={styles.wrap}>{body()}</View>
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 48 },
  wrap: { paddingHorizontal: 16 },
  coinWrap: {
    alignSelf: 'center',
    width: COIN_SIZE,
    height: COIN_SIZE,
    marginTop: 22,
    marginBottom: 26,
  },
  coinFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  coinFill: {
    flex: 1,
    borderRadius: COIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  coinTails: {
    backgroundColor: colors.cream,
    borderColor: 'rgba(232, 89, 12, 0.28)',
  },
  coinT: {
    fontFamily: fonts.display,
    fontSize: 72,
    color: colors.ink,
  },
  row: { flexDirection: 'row', gap: 8 },
  rowBtn: { flex: 1 },
  resultText: {
    fontFamily: fonts.display,
    fontSize: 22,
    textAlign: 'center',
    color: colors.text,
    marginVertical: 4,
  },
  resultStrong: { color: colors.apricotInk },
  footer: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
