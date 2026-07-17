// Live viewer — big score plates, LIVE pulse, live cards, over strip,
// CRR/RRR, extras, fall of wickets, full timeline (FlatList), break timer,
// completed banner. SSE with reconnect + refetch on focus.

import type { ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMatch } from '../../src/useMatch';
import { currentInnings, fmtOvers, teamsLine } from '../../src/format';
import AdBanner from '../../src/components/AdBanner';
import { PageBackground, SiteHeader } from '../../src/components/Screen';
import ScorePlates from '../../src/components/ScorePlates';
import BatterCard from '../../src/components/BatterCard';
import BowlerCard from '../../src/components/BowlerCard';
import OverStrip from '../../src/components/OverStrip';
import TimelineRow from '../../src/components/Timeline';
import StatusChip from '../../src/components/StatusChip';
import BreakTimer from '../../src/components/BreakTimer';
import TossLine from '../../src/components/TossLine';
import { Btn, Hint, Panel, PanelTitle } from '../../src/components/ui';
import { colors, fonts, radius, shadowSm } from '../../src/theme';
import type { TimelineEntry } from '../../src/types';

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = typeof id === 'string' ? id : undefined;
  const { state, connected, error } = useMatch(matchId);
  const i = currentInnings(state);
  const insets = useSafeAreaInsets();

  function scoreContext(): ReactNode {
    if (error) return <Text style={styles.context}>Couldn&apos;t load this match — {error}</Text>;
    if (!state) return <Text style={styles.context}>Loading match…</Text>;
    if (!i) return <Text style={styles.context}>The match is being set up — the first ball will appear here.</Text>;
    const batTeam = state.config.teams[i.battingTeamIndex].name;
    if (state.status === 'innings_break') {
      const chaseTeam = state.config.teams[1 - i.battingTeamIndex].name;
      return (
        <Text style={styles.context}>
          Innings break — <Text style={styles.contextStrong}>{chaseTeam}</Text> need {i.runs + 1} to win.
        </Text>
      );
    }
    if (state.currentInningsIndex === 1 && i.target != null) {
      return (
        <Text style={styles.context}>
          <Text style={styles.contextStrong}>{batTeam}</Text> chasing {i.target} — need{' '}
          <Text style={styles.contextStrong}>{i.runsNeeded}</Text> from{' '}
          <Text style={styles.contextStrong}>{i.ballsRemaining}</Text> · CRR {i.crr} · RRR {i.rrr}
        </Text>
      );
    }
    return (
      <Text style={styles.context}>
        <Text style={styles.contextStrong}>{batTeam}</Text> batting · CRR {i.crr}
      </Text>
    );
  }

  // Never blank: explain what is (or isn't) happening.
  const idleCardsMessage = state?.status === 'innings_break'
    ? 'Innings break — the chase starts shortly.'
    : state?.status === 'completed'
      ? 'Match over — the full scorecard is on the summary page.'
      : 'The match is being set up — players appear when the first innings starts.';

  const x = i?.extras;
  const showBreakTimer = state?.status === 'innings_break'
    && state?.inningsBreak?.startedAt != null;

  // Newest-first timeline for the FlatList.
  const timeline: TimelineEntry[] = i?.timeline ? [...i.timeline].reverse() : [];

  const header = (
    <View style={styles.wrap}>
      {state?.status === 'completed' && state.result && (
        <View style={styles.resultBanner}>
          <Text style={styles.resultText}>{state.result.text}</Text>
          <View style={{ marginTop: 14 }}>
            <Btn title="View full scorecard" onPress={() => router.push(`/summary/${matchId}`)} />
          </View>
        </View>
      )}

      <Panel style={styles.scorePanel}>
        {i ? (
          <ScorePlates
            big
            runs={i.runs}
            wickets={i.wickets}
            overs={i.oversDisplay ?? fmtOvers(i.legalBalls)}
          />
        ) : (
          <ScorePlates big runs={0} wickets={0} overs="0.0" />
        )}
        <View style={{ marginTop: 6 }}>{scoreContext()}</View>
      </Panel>

      {/* Below the score, never on the umpire console. Renders nothing for
          ad-free accounts / server ads-off / builds without the ads module. */}
      <AdBanner />

      {showBreakTimer && (
        <Panel>
          <BreakTimer inningsBreak={state!.inningsBreak} />
        </Panel>
      )}

      <View style={styles.cards}>
        {!i || state?.status !== 'live' ? (
          showBreakTimer ? null : (
            <View style={styles.placeholderCard}>
              <Hint>{idleCardsMessage}</Hint>
              {state?.status === 'setup' && <TossLine state={state} />}
            </View>
          )
        ) : (
          <>
            <BatterCard innings={i} batsmanIndex={i.strikerIndex} onStrike commonName={state?.config.commonPlayer ?? null} />
            <BatterCard innings={i} batsmanIndex={i.nonStrikerIndex} onStrike={false} commonName={state?.config.commonPlayer ?? null} />
          </>
        )}
        {i && state?.status === 'live' && (
          <BowlerCard
            bowler={i.currentBowlerIndex != null ? i.bowlers[i.currentBowlerIndex] : null}
            waitingText="Waiting for the next bowler…"
            commonName={state?.config.commonPlayer ?? null}
          />
        )}
      </View>

      <Panel style={{ marginTop: 16 }}>
        <PanelTitle>This over</PanelTitle>
        <OverStrip innings={i} />
      </Panel>

      <Panel style={{ marginBottom: 0 }}>
        <PanelTitle>Innings</PanelTitle>
        {x && (
          <Text style={styles.extrasLine}>
            Extras <Text style={styles.extrasStrong}>{x.total}</Text> (wd {x.wides}, nb {x.noballs}, b {x.byes}, lb {x.legbyes})
          </Text>
        )}
        <View style={styles.fowList}>
          {!i ? (
            <Hint>Fall of wickets will appear here.</Hint>
          ) : i.fallOfWickets.length ? (
            i.fallOfWickets.map((w, idx) => (
              <Text key={idx} style={styles.fowRow}>
                <Text style={styles.extrasStrong}>{w.score}/{w.wicket}</Text> {w.batsmanName} · {w.over} ov
              </Text>
            ))
          ) : (
            <Hint>No wickets down yet.</Hint>
          )}
        </View>
        <Text style={styles.timelineTitle}>Full timeline</Text>
        {!timeline.length && (
          <Hint>No balls bowled yet — every delivery will be logged here.</Hint>
        )}
      </Panel>
    </View>
  );

  return (
    <PageBackground>
      <FlatList
        data={timeline}
        keyExtractor={(_, idx) => `${state?.currentInningsIndex ?? 0}:${timeline.length - idx}`}
        renderItem={({ item }) => (
          <View style={styles.timelineRowWrap}>
            <TimelineRow entry={item} />
          </View>
        )}
        ListHeaderComponent={(
          <View>
            <SiteHeader
              teams={teamsLine(state)}
              right={state
                ? <StatusChip status={state.status} />
                : <Hint>Loading…</Hint>}
            />
            {header}
          </View>
        )}
        contentContainerStyle={styles.scroll}
      />
      {!connected && (
        <View style={[styles.reconnectPill, { top: insets.top + 8 }]}>
          <Text style={styles.reconnectText}>Reconnecting…</Text>
        </View>
      )}
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 48 },
  wrap: { paddingHorizontal: 16 },
  context: { color: colors.muted, fontSize: 14, marginTop: 2 },
  contextStrong: { color: colors.text, fontWeight: '600' },
  scorePanel: {
    borderColor: 'rgba(255, 169, 77, 0.55)',
  },
  cards: { gap: 10 },
  placeholderCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 12,
    ...shadowSm,
  },
  resultBanner: {
    borderWidth: 1,
    borderColor: 'rgba(255, 169, 77, 0.6)',
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  resultText: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.apricotInk,
    textAlign: 'center',
  },
  extrasLine: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
    marginBottom: 10,
  },
  extrasStrong: { color: colors.text },
  fowList: { gap: 4 },
  fowRow: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
  },
  timelineTitle: {
    marginTop: 14,
    fontSize: 13,
    color: colors.muted,
  },
  timelineRowWrap: { paddingHorizontal: 30 },
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
