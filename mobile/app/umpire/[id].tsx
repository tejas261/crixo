// Umpire console — drives the pad and sheets purely off publicState + `needs`.
// Faithful port of the web console (app/umpire/[id]/page.tsx), with the
// mobile auth model: the adminKey lives in the device keychain
// (expo-secure-store) and rides along on every event POST.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  claimMatch,
  deleteAdminKey,
  getBaseUrl,
  getStoredAdminKey,
  postMatchEvent,
  storeAdminKey,
  type ApiError,
} from '../../src/api';
import { useMatch } from '../../src/useMatch';
import { currentInnings, fmtOvers, teamsLine } from '../../src/format';
import { PageBackground, SiteHeader } from '../../src/components/Screen';
import ScorePlates from '../../src/components/ScorePlates';
import BatterCard from '../../src/components/BatterCard';
import BowlerCard from '../../src/components/BowlerCard';
import OverStrip from '../../src/components/OverStrip';
import Avatar, { type AvatarRole } from '../../src/components/Avatar';
import Sheet, { SheetSub, SheetTitle } from '../../src/components/Sheet';
import BreakTimer from '../../src/components/BreakTimer';
import TossLine, { BothChip } from '../../src/components/TossLine';
import RematchButton from '../../src/components/RematchButton';
import { toast } from '../../src/components/Toast';
import { BoomPill, Btn, Hint, Input, Panel, PanelTitle, SheetSectionLabel } from '../../src/components/ui';
import { colors, fonts, radius, shadowSm } from '../../src/theme';
import type {
  BallEvent,
  BallExtra,
  MatchEvent,
  Needs,
  PublicInnings,
  PublicState,
  UndoEvent,
  WicketInfo,
  WicketKind,
} from '../../src/types';
import { Pressable } from 'react-native';

// Extras selectable on the pad ('none' is the absence of a selection).
type PadExtra = Exclude<BallExtra, 'none'>;

type PostableEvent = MatchEvent | UndoEvent;
type PostEvent = (event: PostableEvent) => Promise<boolean>;

const EXTRAS: [PadExtra, string][] = [
  ['wide', 'wide'],
  ['noball', 'no-ball'],
  ['bye', 'bye'],
  ['legbye', 'leg-bye'],
];

const WICKET_KINDS: [WicketKind, string][] = [
  ['bowled', 'Bowled'], ['caught', 'Caught'], ['lbw', 'Lbw'],
  ['stumped', 'Stumped'], ['run_out', 'Run out'], ['hit_wicket', 'Hit wicket'],
];

function legalKinds(extra: PadExtra | null): WicketKind[] {
  if (extra === 'wide') return ['run_out', 'stumped'];
  if (extra === 'noball') return ['run_out'];
  return WICKET_KINDS.map(([k]) => k);
}

// A team's ACTIVE roster as {name, playerIndex} pairs — removed (left)
// players are filtered out but the surviving indexes are the real
// config.teams[t].players indexes (they never shift; v14 add_player pushes).
function activePlayers(state: PublicState, teamIndex: number): { p: string; idx: number }[] {
  const removed = new Set(state.removed?.[teamIndex] ?? []);
  return state.config.teams[teamIndex].players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => !removed.has(idx));
}

export default function UmpireScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = typeof id === 'string' ? id : undefined;
  const { state, setState, connected, error } = useMatch(matchId);
  const insets = useSafeAreaInsets();

  // The device's scoring credential — present = this device may score.
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  const [selectedExtra, setSelectedExtra] = useState<PadExtra | null>(null);
  const [wicketOpen, setWicketOpen] = useState(false);
  const [squadsOpen, setSquadsOpen] = useState(false);
  const [changeBowlerOpen, setChangeBowlerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'endInnings' | 'endMatch' | null>(null);
  const [completedDismissed, setCompletedDismissed] = useState(false); // completed sheet shows once, then stays closed
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false); // synchronous guard: React state lags a tap

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    getStoredAdminKey(matchId)
      .then((k) => { if (!cancelled) setAdminKey(k); })
      .finally(() => { if (!cancelled) setKeyLoaded(true); });
    return () => { cancelled = true; };
  }, [matchId]);

  const scorer = adminKey != null;

  // ---------- Event posting ----------
  // Returns true on success, false on any failure, so multi-event sequences
  // (openers flow) can abort instead of posting on top of a failed step.
  async function postEvent(event: PostableEvent): Promise<boolean> {
    if (!matchId) return false;
    if (postingRef.current) {
      toast('Still sending the last ball…');
      return false;
    }
    postingRef.current = true;
    setPosting(true); // pad is visibly inert while the POST is in flight
    try {
      const next = await postMatchEvent(matchId, event, adminKey);
      setState(next); // snappy; SSE will confirm with the same state
      return true;
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 403) {
        // Key revoked or DB reset — drop it and re-prompt.
        toast('Scoring access was rejected — paste the admin key to score.');
        setAdminKey(null);
        await deleteAdminKey(matchId);
      } else {
        toast(e.message);
      }
      return false;
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  }

  // ---------- Derived ----------

  const i = currentInnings(state);
  const needs: Partial<Needs> = state?.needs || {};
  const canScore = scorer && state?.status === 'live'
    && !needs.openers && !needs.newBatsman && !needs.newBowler && !needs.startInnings;
  const padOk = Boolean(canScore) && !posting;

  // Boom-boom over (v14). Arming is only offered at an over boundary;
  // legalBalls % 6 === 0 is a heuristic — it can't see an illegal first
  // delivery (a first-ball wide keeps it 0 mid-over) — so the server's 400
  // toast is the real gate.
  const boomArmed = Boolean(state?.config.boomBoom && state.status === 'live' && i?.boomActive);
  const boomArmable = Boolean(
    state?.config.boomBoom && state.status === 'live' && scorer
    && i && !i.boomActive && i.legalBalls % 6 === 0
  );

  // ---------- Sheet key (mirrors the web console's sheetKeyFor) ----------

  const sheetKey = useMemo<string | null>(() => {
    if (!state) return null;
    // Dismissible so the console (including Undo) stays reachable after an
    // accidental end_match, and for read-only visitors.
    if (state.status === 'completed') return completedDismissed ? null : 'completed';
    if (!scorer) return null; // read-only: no action sheets
    // Squads outranks the needs-driven sheets: it can only be opened from the
    // pad footer (no sheet up) or from the start-innings sheet's own footer,
    // and a squad change may itself resolve/raise a `needs` flag — the needs
    // sheet takes back over the moment squads is dismissed.
    if (squadsOpen) return 'squads';
    const n: Partial<Needs> = state.needs || {};
    if (n.startInnings) return `start:${state.status}`;
    if (n.openers) return `openers:${state.currentInningsIndex}`;
    if (n.newBatsman) return `newBatsman:${i?.batsmen.length}`;
    if (n.newBowler) return `newBowler:${i?.legalBalls}`;
    if (confirmAction) return `confirm:${confirmAction}`;
    if (wicketOpen) return 'wicket';
    if (changeBowlerOpen) return 'changeBowler';
    return null;
  }, [state, scorer, completedDismissed, squadsOpen, confirmAction, wicketOpen, changeBowlerOpen, i]);

  const dismissHandler = useMemo<(() => void) | undefined>(() => {
    if (sheetKey === 'wicket') return () => setWicketOpen(false);
    if (sheetKey === 'squads') return () => setSquadsOpen(false);
    if (sheetKey === 'changeBowler') return () => setChangeBowlerOpen(false);
    if (sheetKey?.startsWith('confirm:')) return () => setConfirmAction(null);
    if (sheetKey === 'completed') return () => setCompletedDismissed(true);
    return undefined;
  }, [sheetKey]);

  // Quiet escape hatch inside needs-driven sheets: a mis-recorded ball (e.g.
  // a phantom wicket) can be undone without first satisfying the sheet.
  const showUndoFooter = Boolean(
    state?.innings.length && (i?.timeline.length || state?.status === 'innings_break')
  );
  const undoFooter: ReactNode = showUndoFooter ? (
    <View style={styles.sheetFooter}>
      <View />
      <Btn title="Undo last ball" variant="quiet" onPress={() => postEvent({ type: 'undo' })} />
    </View>
  ) : null;

  // ---------- Bits of render ----------

  function scoreContext(): ReactNode {
    if (error) return <Text style={styles.context}>Couldn&apos;t load this match — {error}</Text>;
    if (!state) return <Text style={styles.context}>Loading match…</Text>;
    if (state.status === 'setup') {
      return (
        <View>
          <Text style={styles.context}>
            Match set up — start the first innings when both sides are ready.
          </Text>
          <TossLine state={state} />
        </View>
      );
    }
    if (state.status === 'completed') {
      return <Text style={[styles.context, styles.contextStrong]}>{state.result?.text || 'Match over'}</Text>;
    }
    if (state.status === 'innings_break') {
      const first = state.innings[0];
      const chaseTeam = state.config.teams[1 - first.battingTeamIndex].name;
      return (
        <Text style={styles.context}>
          Innings break — <Text style={styles.contextStrong}>{chaseTeam}</Text> need {first.runs + 1} to win.
        </Text>
      );
    }
    if (i) {
      const batTeam = state.config.teams[i.battingTeamIndex].name;
      // Boom state rides on the context line so everyone (read-only included)
      // sees it; penalties reconcile the total with the batting card sums.
      const boomBits = (
        <>
          {i.boomActive && <Text style={styles.contextStrong}> · BOOM ×2, wickets −5</Text>}
          {(i.penaltyRuns ?? 0) > 0 && <Text> · boom −{i.penaltyRuns}</Text>}
        </>
      );
      if (state.currentInningsIndex === 1 && i.target != null) {
        return (
          <Text style={styles.context}>
            <Text style={styles.contextStrong}>{batTeam}</Text> chasing {i.target} — need{' '}
            {i.runsNeeded} from {i.ballsRemaining} · CRR {i.crr} · RRR {i.rrr}{boomBits}
          </Text>
        );
      }
      return (
        <Text style={styles.context}>
          <Text style={styles.contextStrong}>{batTeam}</Text> batting · first innings · CRR {i.crr}{boomBits}
        </Text>
      );
    }
    return null;
  }

  async function saveKey() {
    if (!matchId) return;
    const v = keyInput.trim();
    if (!v) {
      toast('Paste the admin key first.');
      return;
    }
    // Claim returns 204 on a valid key — used purely as verification here
    // (cookies are unreliable in RN; the key itself rides with every event).
    try {
      await claimMatch(matchId, v);
    } catch (err) {
      toast((err as ApiError).message); // server's 403 'invalid admin key' / 404
      return;
    }
    await storeAdminKey(matchId, v);
    setAdminKey(v);
    setKeyInput('');
    toast('Key accepted — you can score now.', 'ok');
  }

  const shareSummary = () => {
    Share.share({ message: `${getBaseUrl()}/summary/${matchId}` }).catch(() => {});
  };

  function padTapBall(runs: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const event: BallEvent = {
      type: 'ball',
      extra: selectedExtra || 'none',
      runs,
      wicket: null,
    };
    setSelectedExtra(null);
    postEvent(event);
  }

  function sheetContent(): ReactNode {
    if (!sheetKey || !state || !matchId) return null;

    if (sheetKey === 'completed') {
      return (
        <View key={sheetKey}>
          <SheetTitle>Match over</SheetTitle>
          <SheetSub>{state.result?.text || ''}</SheetSub>
          <Btn
            title="View summary" variant="primary"
            onPress={() => { setCompletedDismissed(true); router.push(`/summary/${matchId}`); }}
          />
          <View style={{ marginTop: 8 }}>
            <RematchButton state={state} />
          </View>
          <View style={{ marginTop: 8 }}>
            <Btn title="Share summary" onPress={shareSummary} />
          </View>
          {scorer && adminKey && (
            <View style={{ marginTop: 12 }}>
              <ScoringKeyRow adminKey={adminKey} />
            </View>
          )}
          <View style={styles.sheetFooter}>
            <Btn title="Close" variant="quiet" onPress={() => setCompletedDismissed(true)} />
            {scorer && (
              <Btn title="Undo last ball" variant="quiet" onPress={() => postEvent({ type: 'undo' })} />
            )}
          </View>
        </View>
      );
    }
    if (sheetKey.startsWith('start:')) {
      const second = state.status === 'innings_break';
      return (
        <View key={sheetKey}>
          <SheetTitle>{second ? 'Start second innings' : 'Start first innings'}</SheetTitle>
          <SheetSub>
            {second
              ? `${state.config.teams[1 - state.innings[0].battingTeamIndex].name} need ${state.innings[0].runs + 1} to win.`
              : `${state.config.teams[state.config.battingFirstIndex].name} bat first.`}
          </SheetSub>
          {!second && <TossLine state={state} />}
          {/* Live break clock (renders nothing when the field is absent). */}
          {second && (
            <View style={{ marginVertical: 10 }}>
              <BreakTimer inningsBreak={state.inningsBreak} />
            </View>
          )}
          <View style={{ marginTop: 18 }}>
            <Btn
              title={second ? 'Start second innings' : 'Start innings'}
              variant="primary"
              onPress={() => postEvent({ type: 'start_innings' })}
            />
          </View>
          {/* Squads stays reachable while this sheet blocks the pad footer
              (add a latecomer before the innings starts); plus the quiet toss
              detour before the first ball, or Undo during the break. */}
          <View style={styles.sheetFooter}>
            <Btn title="Squads" variant="quiet" onPress={() => setSquadsOpen(true)} />
            {!second && !state.toss ? (
              <Btn title="Hold the toss" variant="quiet" onPress={() => router.push(`/toss/${matchId}`)} />
            ) : second && showUndoFooter ? (
              <Btn title="Undo last ball" variant="quiet" onPress={() => postEvent({ type: 'undo' })} />
            ) : (
              <View />
            )}
          </View>
        </View>
      );
    }
    if (sheetKey.startsWith('confirm:')) {
      const endMatch = sheetKey === 'confirm:endMatch';
      return (
        <View key={sheetKey}>
          <SheetTitle>{endMatch ? 'End the match now?' : 'End this innings now?'}</SheetTitle>
          <SheetSub>
            {endMatch
              ? 'A result will be recorded from the current score.'
              : 'The innings will close at the current score.'}
          </SheetSub>
          <View style={styles.rowGap}>
            <Btn title="Cancel" onPress={() => setConfirmAction(null)} />
            <Btn
              title={endMatch ? 'End match' : 'End innings'}
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => {
                setConfirmAction(null);
                postEvent({ type: endMatch ? 'end_match' : 'end_innings' });
              }}
            />
          </View>
        </View>
      );
    }
    // The needs-driven and wicket sheets only ever render while their innings
    // exists (the engine's `needs` flags guarantee it), hence the assertions.
    if (sheetKey.startsWith('openers:')) {
      return <OpenersSheet key={sheetKey} state={state} innings={i!} postEvent={postEvent} />;
    }
    if (sheetKey.startsWith('newBatsman:')) {
      return (
        <NewBatsmanSheet key={sheetKey} state={state} innings={i!} postEvent={postEvent} undoFooter={undoFooter} />
      );
    }
    if (sheetKey.startsWith('newBowler:')) {
      return (
        <NewBowlerSheet key={sheetKey} state={state} innings={i!} postEvent={postEvent} undoFooter={undoFooter} />
      );
    }
    if (sheetKey === 'squads') {
      return (
        <SquadsSheet
          key={sheetKey}
          state={state}
          postEvent={postEvent}
          posting={posting}
          onClose={() => setSquadsOpen(false)}
        />
      );
    }
    if (sheetKey === 'changeBowler') {
      return (
        <ChangeBowlerSheet
          key={sheetKey}
          state={state}
          innings={i!}
          postEvent={postEvent}
          onClose={() => setChangeBowlerOpen(false)}
        />
      );
    }
    if (sheetKey === 'wicket') {
      return (
        <WicketSheet
          key={sheetKey}
          innings={i!}
          selectedExtra={selectedExtra}
          onCancel={() => setWicketOpen(false)}
          onConfirm={(wicket, runs) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            const event: BallEvent = {
              type: 'ball',
              extra: selectedExtra || 'none',
              runs,
              wicket,
            };
            setWicketOpen(false);
            setSelectedExtra(null);
            postEvent(event);
          }}
        />
      );
    }
    return null;
  }

  return (
    <PageBackground>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <SiteHeader
            teams={teamsLine(state)}
            right={<Btn title="Live view" variant="quiet" onPress={() => router.push(`/m/${matchId}`)} />}
          />
          <View style={styles.wrap}>
            {keyLoaded && !scorer && (
              <View style={styles.consoleNote}>
                <Text style={styles.noteText}>
                  This console is read-only — paste the admin key for this match to score it.
                </Text>
                <View style={[styles.rowGap, { marginTop: 8 }]}>
                  <Input
                    placeholder="Admin key"
                    value={keyInput}
                    onChangeText={setKeyInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ flex: 1 }}
                  />
                  <Btn title="Save key" onPress={saveKey} small />
                </View>
              </View>
            )}
            {scorer && adminKey && (
              <View style={styles.consoleNote}>
                <ScoringKeyRow adminKey={adminKey} />
              </View>
            )}

            <Panel style={styles.scorePanel}>
              {i ? (
                <ScorePlates
                  runs={i.runs}
                  wickets={i.wickets}
                  overs={i.oversDisplay ?? fmtOvers(i.legalBalls)}
                />
              ) : (
                <ScorePlates runs={0} wickets={0} overs="0.0" />
              )}
              <View style={{ marginTop: 6 }}>{scoreContext()}</View>
            </Panel>

            <View style={styles.cards}>
              {!i || state?.status === 'setup' ? (
                <View style={styles.placeholderCard}>
                  <Hint>Batsmen appear here once the innings starts.</Hint>
                </View>
              ) : (
                <>
                  <BatterCard innings={i} batsmanIndex={i.strikerIndex} onStrike commonName={state?.config.commonPlayer ?? null} />
                  <BatterCard innings={i} batsmanIndex={i.nonStrikerIndex} onStrike={false} commonName={state?.config.commonPlayer ?? null} />
                </>
              )}
              {/* Correction: swap who is on strike (engine swap_strike —
                  valid whenever both batsmen are at the crease, undoable). */}
              {scorer && state?.status === 'live' && i
                && i.strikerIndex != null && i.nonStrikerIndex != null && (
                <View style={styles.cardsActions}>
                  <Btn
                    title="Swap strike" variant="quiet" disabled={posting}
                    onPress={() => postEvent({ type: 'swap_strike' })}
                  />
                </View>
              )}
              {i && state?.status !== 'setup' && (
                <BowlerCard
                  bowler={i.currentBowlerIndex != null ? i.bowlers[i.currentBowlerIndex] : null}
                  waitingText="Waiting for a bowler…"
                  commonName={state?.config.commonPlayer ?? null}
                />
              )}
              {/* Correction: re-pick the bowler before the over's first ball.
                  Same over-boundary heuristic as the boom chip — the server
                  400s (toast) if a wide already opened the over. */}
              {scorer && state?.status === 'live' && i
                && i.currentBowlerIndex != null && i.legalBalls % 6 === 0 && (
                <View style={styles.cardsActions}>
                  <Btn
                    title="Change bowler" variant="quiet" disabled={posting}
                    onPress={() => setChangeBowlerOpen(true)}
                  />
                </View>
              )}
            </View>

            <Panel style={{ marginTop: 16 }}>
              <PanelTitle>This over</PanelTitle>
              <OverStrip innings={i} />
            </Panel>
          </View>
        </ScrollView>

        {/* Fixed one-thumb pad */}
        <View style={[styles.pad, { paddingBottom: 10 + insets.bottom }]}>
          {/* Boom-boom slot above the pad: arm chip at an over boundary,
              pulsing BOOM pill (+ cancel) while armed. */}
          {boomArmable && (
            <View style={styles.boomRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: posting }}
                disabled={posting}
                onPress={() => postEvent({ type: 'boom_over', enabled: true })}
                style={[styles.boomArmChip, posting && styles.disabled]}
              >
                <Text style={styles.boomArmText}>Boom-boom this over</Text>
              </Pressable>
            </View>
          )}
          {boomArmed && (
            <View style={[styles.boomRow, { justifyContent: 'space-between' }]}>
              <BoomPill />
              {scorer && (
                <Btn
                  title="Cancel" variant="quiet" disabled={posting}
                  onPress={() => postEvent({ type: 'boom_over', enabled: false })}
                />
              )}
            </View>
          )}
          <View style={styles.runGrid}>
            {[0, 1, 2, 3, 4, 6].map((r) => (
              <RunButton key={r} runs={r} disabled={!padOk} onPress={() => padTapBall(r)} />
            ))}
          </View>
          <View style={styles.extrasRow}>
            {EXTRAS.map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedExtra === value, disabled: !padOk }}
                disabled={!padOk}
                onPress={() => setSelectedExtra(selectedExtra === value ? null : value)}
                style={[
                  styles.chip,
                  selectedExtra === value && styles.chipOn,
                  !padOk && styles.disabled,
                ]}
              >
                <Text style={[styles.chipText, selectedExtra === value && styles.chipTextOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowGap}>
            <Btn
              title="Wicket" variant="danger" disabled={!padOk}
              onPress={() => setWicketOpen(true)} style={{ flex: 1 }}
            />
            <Btn
              title="Undo last ball"
              disabled={!scorer || posting || !state || state.status === 'setup'}
              onPress={() => postEvent({ type: 'undo' })}
              style={{ flex: 1 }}
            />
          </View>
          <View style={styles.padFooter}>
            <Btn
              title="Squads" variant="quiet"
              disabled={!scorer || !state || state.status === 'completed'}
              onPress={() => setSquadsOpen(true)}
            />
            <Btn
              title="End innings" variant="quiet"
              disabled={!scorer || posting || state?.status !== 'live'}
              onPress={() => setConfirmAction('endInnings')}
            />
            <Btn
              title="End match" variant="quiet"
              disabled={!scorer || posting || !state || state.status === 'completed'}
              onPress={() => setConfirmAction('endMatch')}
            />
          </View>
        </View>

        {!connected && (
          <View style={[styles.reconnectPill, { top: insets.top + 8 }]}>
            <Text style={styles.reconnectText}>Reconnecting…</Text>
          </View>
        )}

        <Sheet open={Boolean(sheetKey)} onDismiss={dismissHandler}>
          {sheetContent()}
        </Sheet>
      </View>
    </PageBackground>
  );
}

// ---------- Run button (cream tile; 4 outlined, 6 on THE gradient) ----------

function RunButton({ runs, disabled, onPress }: { runs: number; disabled: boolean; onPress: () => void }) {
  if (runs === 6) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.runBtnFrame, disabled && styles.disabled, pressed && !disabled && styles.pressed,
        ]}
      >
        <LinearGradient
          colors={['#FFB86B', '#FFE08A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.runBtnSixFill}
        >
          <Text style={[styles.runBtnText, styles.runBtnSixText]}>6</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.runBtn,
        runs === 4 && styles.runBtnFour,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.runBtnText, runs === 4 && styles.runBtnFourText]}>{runs}</Text>
    </Pressable>
  );
}

// ---------- Scoring key row ----------

// Cross-device handoff: another phone takes over by claiming this key.
function ScoringKeyRow({ adminKey }: { adminKey: string }) {
  return (
    <View style={styles.keyRow}>
      <Text style={styles.keyLabel}>Scoring key</Text>
      <Text style={styles.keyCode} numberOfLines={1}>{adminKey}</Text>
      <Btn
        title="Copy" variant="quiet"
        onPress={async () => {
          try {
            await Clipboard.setStringAsync(adminKey);
            toast('Copied', 'ok');
          } catch {
            toast("Couldn't copy — write it down instead.");
          }
        }}
      />
    </View>
  );
}

// ---------- Shared pick button ----------

interface PickButtonProps {
  name: string;
  role: AvatarRole;
  pressed?: boolean;
  disabled?: boolean;
  note?: string | null;
  onClick: () => void;
}

function PickButton({ name, role, pressed = false, disabled = false, note = null, onClick }: PickButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: pressed, disabled }}
      disabled={disabled}
      onPress={onClick}
      style={[styles.pick, pressed && styles.pickOn, disabled && styles.pickDisabled]}
    >
      <Avatar name={name} role={role} size={26} />
      <Text style={[styles.pickText, pressed && styles.pickTextOn]}>{name}</Text>
      {note ? <Text style={styles.pickNote}>{note}</Text> : null}
    </Pressable>
  );
}

// ---------- Sheets ----------

interface OpenersSheetProps {
  state: PublicState;
  innings: PublicInnings;
  postEvent: PostEvent;
}

// Openers — collects both batsmen AND the opening bowler in one flow. On
// confirm the picks are snapshotted and posted one event at a time, aborting
// on the first failure so a transient error can't install the wrong batsman
// at the wrong end.
function OpenersSheet({ state, innings, postEvent }: OpenersSheetProps) {
  const [striker, setStriker] = useState<number | null>(null);
  const [nonStriker, setNonStriker] = useState<number | null>(null);
  const [bowler, setBowler] = useState<number | null>(null);

  // Removed (left) players are not selectable — the engine rejects them.
  const bat = activePlayers(state, innings.battingTeamIndex);
  const bowl = activePlayers(state, 1 - innings.battingTeamIndex);

  async function confirm() {
    // Snapshot the picks first: the sheet may unmount mid-sequence as `needs`
    // transitions after each accepted event.
    const picks = { striker: striker!, nonStriker: nonStriker!, bowler: bowler! };
    if (!await postEvent({ type: 'select_batsman', playerIndex: picks.striker })) return;
    if (!await postEvent({ type: 'select_batsman', playerIndex: picks.nonStriker })) return;
    await postEvent({ type: 'select_bowler', playerIndex: picks.bowler });
  }

  return (
    <View>
      <SheetTitle>Pick openers</SheetTitle>
      <SheetSub>Choose the two opening batsmen and the opening bowler.</SheetSub>
      <SheetSectionLabel>On strike</SheetSectionLabel>
      <View style={styles.pickList}>
        {bat.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="batsman"
            pressed={striker === idx}
            disabled={idx === nonStriker}
            onClick={() => setStriker(idx)}
          />
        ))}
      </View>
      <SheetSectionLabel>Non-striker</SheetSectionLabel>
      <View style={styles.pickList}>
        {bat.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="batsman"
            pressed={nonStriker === idx}
            disabled={idx === striker}
            onClick={() => setNonStriker(idx)}
          />
        ))}
      </View>
      <SheetSectionLabel>Opening bowler</SheetSectionLabel>
      <View style={styles.pickList}>
        {bowl.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="bowler"
            pressed={bowler === idx}
            onClick={() => setBowler(idx)}
          />
        ))}
      </View>
      <View style={{ marginTop: 18 }}>
        <Btn
          title="Start the over"
          variant="primary"
          disabled={striker == null || nonStriker == null || bowler == null}
          onPress={confirm}
        />
      </View>
    </View>
  );
}

interface NewPlayerSheetProps {
  state: PublicState;
  innings: PublicInnings;
  postEvent: PostEvent;
  undoFooter: ReactNode;
}

function NewBatsmanSheet({ state, innings, postEvent, undoFooter }: NewPlayerSheetProps) {
  // Eligible = still in the squad (not removed) and hasn't batted this innings.
  const used = new Set(innings.batsmen.map((b) => b.playerIndex));
  const eligible = activePlayers(state, innings.battingTeamIndex)
    .filter(({ idx }) => !used.has(idx));
  return (
    <View>
      <SheetTitle>New batsman</SheetTitle>
      <SheetSub>Pick who comes in next.</SheetSub>
      <View style={styles.pickList}>
        {eligible.length ? (
          eligible.map(({ p, idx }) => (
            <PickButton
              key={idx} name={p} role="batsman"
              onClick={() => postEvent({ type: 'select_batsman', playerIndex: idx })}
            />
          ))
        ) : (
          <Hint>No batsmen left to come in.</Hint>
        )}
      </View>
      {undoFooter}
    </View>
  );
}

function NewBowlerSheet({ state, innings, postEvent, undoFooter }: NewPlayerSheetProps) {
  // Removed (left) players are excluded; the engine also guards this.
  const bowl = activePlayers(state, 1 - innings.battingTeamIndex);
  // currentBowlerIndex is null at over end; the engine exposes the last
  // completed over's bowler separately so we can disable them here.
  const prev = innings.lastOverBowlerPlayerIndex ?? null;
  return (
    <View>
      <SheetTitle>New bowler</SheetTitle>
      <SheetSub>Pick who bowls the next over.</SheetSub>
      <View style={styles.pickList}>
        {bowl.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="bowler"
            disabled={idx === prev}
            note={idx === prev ? 'bowled the last over' : null}
            onClick={() => postEvent({ type: 'select_bowler', playerIndex: idx })}
          />
        ))}
      </View>
      {undoFooter}
    </View>
  );
}

// ---------- Change bowler sheet (v15 correction) ----------

// Re-pick the bowler for the over about to start (engine change_bowler —
// same eligibility as select_bowler; rejected once the over has a delivery).
function ChangeBowlerSheet({ state, innings, postEvent, onClose }: {
  state: PublicState;
  innings: PublicInnings;
  postEvent: PostEvent;
  onClose: () => void;
}) {
  const bowl = activePlayers(state, 1 - innings.battingTeamIndex);
  const prev = innings.lastOverBowlerPlayerIndex ?? null;
  const current = innings.currentBowlerIndex != null
    ? innings.bowlers[innings.currentBowlerIndex].playerIndex
    : null;
  return (
    <View>
      <SheetTitle>Change bowler</SheetTitle>
      <SheetSub>Re-pick who bowls this over — allowed until the first ball is bowled.</SheetSub>
      <View style={styles.pickList}>
        {bowl.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="bowler"
            disabled={idx === prev || idx === current}
            note={idx === current
              ? 'currently selected'
              : idx === prev ? 'bowled the last over' : null}
            onClick={async () => {
              if (await postEvent({ type: 'change_bowler', playerIndex: idx })) onClose();
            }}
          />
        ))}
      </View>
      <View style={styles.sheetFooter}>
        <View />
        <Btn title="Cancel" variant="quiet" onPress={onClose} />
      </View>
    </View>
  );
}

// ---------- Squads sheet (v14 mid-match squad changes) ----------

interface SquadsSheetProps {
  state: PublicState;
  postEvent: PostEvent;
  posting: boolean;
  onClose: () => void;
}

// Both squads, stacked. The remove affordance mirrors the engine guards so
// it never shows when the server would refuse (at the crease, batted this
// innings, bowling right now, last 2 active), but the SERVER stays the
// authority — a rejected event's 400 message surfaces as a toast via
// postEvent.
function SquadsSheet({ state, postEvent, posting, onClose }: SquadsSheetProps) {
  const [commonDraft, setCommonDraft] = useState('');
  const cleanCommon = commonDraft.trim().replace(/\s+/g, ' ');
  // Mid-match common player (v15): only when none exists yet, and only while
  // both squads have room — mirrors the engine guards, server authoritative.
  const bothHaveRoom = ([0, 1] as const).every(
    (t) => state.config.teams[t].players.length - (state.removed?.[t] ?? []).length < 11,
  );

  async function addCommon() {
    if (!cleanCommon || !bothHaveRoom) return;
    if (await postEvent({ type: 'add_common_player', name: cleanCommon })) setCommonDraft('');
  }

  return (
    <View>
      <SheetTitle>Squads</SheetTitle>
      <SheetSub>Add latecomers, or remove players who left — their scorecard entries stay.</SheetSub>
      {([0, 1] as const).map((t) => (
        <SquadTeam key={t} state={state} teamIndex={t} postEvent={postEvent} posting={posting} />
      ))}
      {state.config.commonPlayer == null && (
        <View style={{ marginTop: 4 }}>
          <SheetSectionLabel>Common player — plays for both sides</SheetSectionLabel>
          <View style={styles.rowGap}>
            <Input
              placeholder="Odd headcount? Add them to both squads"
              value={commonDraft}
              onChangeText={setCommonDraft}
              onSubmitEditing={addCommon}
              editable={bothHaveRoom}
              maxLength={40}
              autoCorrect={false}
              returnKeyType="done"
              style={{ flex: 1 }}
            />
            <Btn
              title="Add" small
              disabled={!cleanCommon || !bothHaveRoom || posting}
              onPress={addCommon}
            />
          </View>
          {!bothHaveRoom && (
            <Hint style={{ marginTop: 6 }}>Both squads need room — 11 active players max.</Hint>
          )}
        </View>
      )}
      <View style={styles.sheetFooter}>
        <View />
        <Btn title="Close" variant="quiet" onPress={onClose} />
      </View>
    </View>
  );
}

function SquadTeam({ state, teamIndex, postEvent, posting }: {
  state: PublicState;
  teamIndex: 0 | 1;
  postEvent: PostEvent;
  posting: boolean;
}) {
  const [draft, setDraft] = useState('');
  const team = state.config.teams[teamIndex];
  const removed = new Set(state.removed?.[teamIndex] ?? []);
  const activeCount = team.players.length - removed.size;

  // Live-innings guards only apply while an innings is actually in progress
  // (during setup / innings break the engine allows removing anyone, down to
  // the 2-active floor).
  const live = state.status === 'live' && state.currentInningsIndex != null
    ? state.innings[state.currentInningsIndex]
    : null;
  const batting = live != null && live.battingTeamIndex === teamIndex;
  const currentBowlerPlayer = live != null && !batting && live.currentBowlerIndex != null
    ? live.bowlers[live.currentBowlerIndex].playerIndex
    : null;

  const clean = draft.trim().replace(/\s+/g, ' ');
  const full = activeCount >= 11;

  async function add() {
    if (!clean || full) return;
    // The engine trims/collapses too and rejects active-name duplicates —
    // any 400 surfaces as a toast; the draft survives for a quick fix.
    if (await postEvent({ type: 'add_player', teamIndex, name: clean })) setDraft('');
  }

  return (
    <View style={styles.squadTeam}>
      <View style={styles.squadHead}>
        <Text style={styles.squadName} numberOfLines={1}>{team.name}</Text>
        <Text style={styles.squadCount}>{activeCount} active</Text>
      </View>
      {team.players.map((p, idx) => {
        const left = removed.has(idx);
        // A batsmen entry in the CURRENT innings (out or at the crease)
        // blocks removal until the innings ends — same rule as the engine.
        const entry = !left && batting ? live!.batsmen.find((b) => b.playerIndex === idx) : undefined;
        const atCrease = entry != null && entry.out == null;
        const bowling = currentBowlerPlayer === idx;
        const tag = left ? 'left'
          : atCrease ? 'at crease'
            : entry != null ? 'out'
              : bowling ? 'bowling'
                : null;
        const removable = !left && activeCount > 2 && entry == null && !bowling;
        return (
          <View key={idx} style={[styles.squadRow, left && styles.squadRowLeft]}>
            <Avatar name={p} role={batting ? 'batsman' : 'bowler'} size={26} />
            <Text style={styles.squadPlayer} numberOfLines={1}>{p}</Text>
            {state.config.commonPlayer != null && p === state.config.commonPlayer && !left && (
              <BothChip />
            )}
            {tag != null && (
              <Text style={[styles.squadTag, (atCrease || bowling) && styles.squadTagOn]}>
                {tag}
              </Text>
            )}
            {removable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p} from ${team.name}`}
                disabled={posting}
                onPress={() => postEvent({ type: 'remove_player', teamIndex, playerIndex: idx })}
                style={styles.squadX}
              >
                <Text style={styles.squadXText}>×</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <View style={[styles.rowGap, { marginTop: 8 }]}>
        <Input
          placeholder="Add a player"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          editable={!full}
          maxLength={40}
          autoCorrect={false}
          returnKeyType="done"
          style={{ flex: 1 }}
        />
        <Btn title="Add" onPress={add} disabled={!clean || full || posting} small />
      </View>
      {full && <Hint style={{ marginTop: 6 }}>Squad is full — 11 active players.</Hint>}
    </View>
  );
}

interface WicketSheetProps {
  innings: PublicInnings;
  selectedExtra: PadExtra | null;
  onCancel: () => void;
  onConfirm: (wicket: WicketInfo, runs: number) => void;
}

// Wicket sheet (user-opened; the pad composes ONE `ball` event on confirm).
function WicketSheet({ innings, selectedExtra, onCancel, onConfirm }: WicketSheetProps) {
  const [kind, setKindRaw] = useState<WicketKind | null>(null);
  const [runs, setRuns] = useState(0);
  const [outEnd, setOutEnd] = useState<'striker' | 'non_striker'>('striker');
  const [fielder, setFielder] = useState('');

  const setKind = (k: WicketKind) => {
    setKindRaw(k);
    if (k !== 'run_out') {
      setRuns(0);
      setOutEnd('striker');
    }
  };

  const allowed = legalKinds(selectedExtra);
  const isRunOut = kind === 'run_out';
  const striker = innings.strikerIndex != null
    ? innings.batsmen[innings.strikerIndex].name : 'Striker';
  const nonStriker = innings.nonStrikerIndex != null
    ? innings.batsmen[innings.nonStrikerIndex].name : 'Non-striker';

  return (
    <View>
      <SheetTitle>Wicket</SheetTitle>
      <SheetSub>
        {selectedExtra
          ? `On a ${selectedExtra === 'noball' ? 'no-ball' : selectedExtra} — only ${allowed.map((k) => k.replace('_', ' ')).join(' and ')} ${allowed.length > 1 ? 'are' : 'is'} possible.`
          : 'How did the batsman get out?'}
      </SheetSub>
      <View style={styles.pickList}>
        {WICKET_KINDS.map(([k, label]) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k, disabled: !allowed.includes(k) }}
            disabled={!allowed.includes(k)}
            onPress={() => setKind(k)}
            style={[styles.pick, kind === k && styles.pickOn, !allowed.includes(k) && styles.pickDisabled]}
          >
            <Text style={[styles.pickText, kind === k && styles.pickTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {isRunOut && (
        <View>
          <SheetSectionLabel>Runs completed before the run out</SheetSectionLabel>
          <View style={styles.pickList}>
            {[0, 1, 2, 3, 4, 5, 6].map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityState={{ selected: runs === r }}
                onPress={() => setRuns(r)}
                style={[styles.pick, styles.pickNum, runs === r && styles.pickOn]}
              >
                <Text style={[styles.pickText, runs === r && styles.pickTextOn]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <SheetSectionLabel>Who is out</SheetSectionLabel>
          <View style={styles.pickList}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: outEnd === 'striker' }}
              onPress={() => setOutEnd('striker')}
              style={[styles.pick, outEnd === 'striker' && styles.pickOn]}
            >
              <Text style={[styles.pickText, outEnd === 'striker' && styles.pickTextOn]}>
                {striker} (striker)
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: outEnd === 'non_striker' }}
              onPress={() => setOutEnd('non_striker')}
              style={[styles.pick, outEnd === 'non_striker' && styles.pickOn]}
            >
              <Text style={[styles.pickText, outEnd === 'non_striker' && styles.pickTextOn]}>
                {nonStriker} (non-striker)
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      <SheetSectionLabel>Fielder (optional)</SheetSectionLabel>
      <Input
        placeholder="Fielder's name"
        value={fielder}
        onChangeText={setFielder}
        autoCorrect={false}
      />
      <View style={[styles.rowGap, { marginTop: 18 }]}>
        <Btn title="Cancel" onPress={onCancel} />
        <Btn
          title="Confirm wicket"
          variant="danger"
          style={{ flex: 1 }}
          disabled={!kind}
          onPress={() => onConfirm(
            {
              kind: kind!,
              outEnd: kind === 'run_out' ? outEnd : 'striker',
              fielder: fielder.trim() || null,
            },
            kind === 'run_out' ? runs : 0
          )}
        />
      </View>
    </View>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  scroll: { paddingBottom: 24 },
  wrap: { paddingHorizontal: 16 },
  consoleNote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.apricot,
    backgroundColor: colors.panel,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    ...shadowSm,
  },
  noteText: { fontSize: 14, color: colors.muted },
  scorePanel: {
    borderColor: 'rgba(255, 169, 77, 0.55)',
  },
  context: { color: colors.muted, fontSize: 14, marginTop: 2 },
  contextStrong: { color: colors.text, fontWeight: '600' },
  cards: { gap: 10 },
  // Quiet right-aligned correction actions hanging off the player cards
  // (v15: swap strike / change bowler). Negative margin tucks them under
  // the card they belong to despite the parent's gap.
  cardsActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -6 },
  placeholderCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },

  pad: {
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderColor: colors.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 12,
    shadowColor: '#E6A050',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  runGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  // Boom-boom slot above the run grid.
  boomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  boomArmChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.apricotDeep,
    backgroundColor: '#FFF3E6', // pre-blended apricot tint (see btnToggled in ui.tsx)
    alignItems: 'center',
  },
  boomArmText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.apricotInk,
  },
  runBtn: {
    flexBasis: '31%',
    flexGrow: 1,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  runBtnFour: { borderColor: colors.apricotDeep },
  runBtnFrame: {
    flexBasis: '31%',
    flexGrow: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  runBtnSixFill: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  runBtnText: {
    fontFamily: fonts.mono,
    fontSize: 22,
    color: colors.text,
  },
  runBtnFourText: { color: colors.apricotInk },
  runBtnSixText: { color: colors.ink, fontFamily: fonts.monoBold },
  extrasRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  chipOn: {
    borderColor: colors.apricotDeep,
    backgroundColor: 'rgba(255, 169, 77, 0.14)',
  },
  chipText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
  chipTextOn: { color: colors.apricotInk },
  padFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  rowGap: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.96 }] },

  sheetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pickList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 14,
  },
  pickNum: { paddingHorizontal: 16, paddingLeft: 16 },
  pickOn: {
    borderColor: colors.apricotDeep,
    backgroundColor: 'rgba(255, 169, 77, 0.14)',
  },
  pickDisabled: { opacity: 0.4 },
  pickText: { fontSize: 14, color: colors.text },
  pickTextOn: { color: colors.apricotInk },
  pickNote: { fontSize: 11, color: colors.muted },

  // Squads sheet.
  squadTeam: { marginTop: 14 },
  squadHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 6,
  },
  squadName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  squadCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted },
  squadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(240, 226, 204, 0.6)',
  },
  squadRowLeft: { opacity: 0.45 },
  squadPlayer: { flex: 1, fontSize: 14, color: colors.text },
  squadTag: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  squadTagOn: {
    color: colors.apricotInk,
    borderColor: colors.apricotDeep,
  },
  squadX: { paddingHorizontal: 8, paddingVertical: 2 },
  squadXText: { fontSize: 18, color: colors.muted, lineHeight: 20 },

  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  keyLabel: { color: colors.muted, fontSize: 13 },
  keyCode: {
    flex: 1,
    minWidth: 120,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },

  reconnectPill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.apricotDeep,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 14,
    ...shadowSm,
  },
  reconnectText: { fontSize: 13, color: colors.text },
});
