// Match summary — shareable scorecard. Renders from one GET (no live
// stream; refetches on focus so returning from the live view is fresh).

import { Fragment, useCallback, useState, type ReactNode } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getBaseUrl, getMatch } from '../../src/api';
import { fmtEcon, fmtOvers, fmtSR, teamsLine } from '../../src/format';
import AdBanner from '../../src/components/AdBanner';
import { PageBackground, SiteHeader } from '../../src/components/Screen';
import Avatar, { TrophyMark, type AvatarRole } from '../../src/components/Avatar';
import TossLine, { BothChip } from '../../src/components/TossLine';
import RematchButton from '../../src/components/RematchButton';
import { Btn, EmptyState, Hint, Panel, PanelTitle, SheetSectionLabel } from '../../src/components/ui';
import { colors, fonts, radius, shadowSm } from '../../src/theme';
import type { PublicBatsman, PublicBowler, PublicInnings, PublicState } from '../../src/types';

// "Innings break · Xm Ys" — only when the backend recorded a duration.
function fmtBreak(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = typeof id === 'string' ? id : undefined;
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!matchId) return;
      let cancelled = false;
      getMatch(matchId)
        .then((s) => { if (!cancelled) { setState(s); setError(null); } })
        .catch((err: Error) => { if (!cancelled) setError(err.message); });
      return () => { cancelled = true; };
    }, [matchId])
  );

  const share = () => {
    Share.share({ message: `${getBaseUrl()}/summary/${matchId}` }).catch(() => {});
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SiteHeader
          teams={teamsLine(state)}
          right={<Btn title="Share" variant="quiet" onPress={share} />}
        />
        <View style={styles.wrap}>
          {/* Top of the scorecard. Renders nothing for ad-free accounts /
              server ads-off / builds without the ads module. */}
          <AdBanner />

          <ResultBanner state={state} error={error} matchId={matchId} />

          {state && <TossLine state={state} center />}

          {state && <Highlights state={state} />}

          {state && state.innings.map((i, idx) => (
            <Fragment key={idx}>
              <InningsSection state={state} innings={i} index={idx} />
              {idx === 0 && state.inningsBreak?.durationMs != null && (
                <Text style={styles.breakLine}>
                  — Innings break · {fmtBreak(state.inningsBreak.durationMs)} —
                </Text>
              )}
            </Fragment>
          ))}
        </View>
      </ScrollView>
    </PageBackground>
  );
}

function ResultBanner({ state, error, matchId }: {
  state: PublicState | null;
  error: string | null;
  matchId: string | undefined;
}) {
  if (error) {
    return (
      <Panel>
        <EmptyState>Couldn&apos;t load this match — {error}. Check the link and refresh.</EmptyState>
      </Panel>
    );
  }
  if (!state) {
    return <EmptyState>Loading scorecard…</EmptyState>;
  }
  if (state.result) {
    return (
      <View style={styles.resultBanner}>
        <TrophyMark />
        <Text style={styles.resultText}>{state.result.text}</Text>
        {/* Only a completed match offers a rematch (the component itself
            renders nothing for other states carrying a result). */}
        <RematchButton state={state} />
      </View>
    );
  }
  if (state.status === 'live' || state.status === 'innings_break') {
    return (
      <Panel>
        <EmptyState>
          This match is still in play. The full scorecard will appear here when it ends.
        </EmptyState>
        <Btn title="Watch it live" onPress={() => router.push(`/m/${matchId}`)} />
      </Panel>
    );
  }
  return (
    <Panel>
      <EmptyState>No play has happened in this match yet.</EmptyState>
    </Panel>
  );
}

function Highlights({ state }: { state: PublicState }) {
  let topBat: PublicBatsman | null = null;
  let topBowl: PublicBowler | null = null;
  for (const i of state.innings) {
    for (const b of i.batsmen) {
      if (!topBat || b.runs > topBat.runs) topBat = b;
    }
    for (const bw of i.bowlers) {
      if (!topBowl || bw.wickets > topBowl.wickets
          || (bw.wickets === topBowl.wickets && bw.runs < topBowl.runs)) topBowl = bw;
    }
  }
  if (!topBat && !topBowl) return null;
  return (
    <Panel>
      <PanelTitle>Player highlights</PanelTitle>
      <View style={styles.highlightCards}>
        {topBat && (
          <HighlightCard title="Top scorer" name={topBat.name} role="batsman">
            <Text style={styles.subStrong}>{topBat.runs}</Text> off {topBat.balls} · 4s{' '}
            {topBat.fours} · 6s {topBat.sixes} · SR {fmtSR(topBat.runs, topBat.balls)}
          </HighlightCard>
        )}
        {topBowl && (
          <HighlightCard title="Best bowler" name={topBowl.name} role="bowler">
            <Text style={styles.subStrong}>{topBowl.wickets}/{topBowl.runs}</Text> in{' '}
            {fmtOvers(topBowl.balls)} ov · Econ {fmtEcon(topBowl.runs, topBowl.balls)}
          </HighlightCard>
        )}
      </View>
    </Panel>
  );
}

function HighlightCard({ title, name, role, children }: {
  title: string;
  name: string;
  role: AvatarRole;
  children: ReactNode;
}) {
  return (
    <View style={styles.highlightCard}>
      <Avatar name={name} role={role} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.playerName} numberOfLines={1}>{name}</Text>
        <Text style={styles.playerSub}>{children}</Text>
      </View>
      <Text style={styles.highlightTitle}>{title}</Text>
    </View>
  );
}

// ---------- tables ----------

const BAT_COLS = ['R', 'B', '4s', '6s', 'SR'];
const BOWL_COLS = ['O', 'M', 'R', 'W', 'Econ'];

function HeaderRow({ label, cols }: { label: string; cols: string[] }) {
  return (
    <View style={[styles.tr, styles.trHead]}>
      <Text style={[styles.nameCol, styles.th]}>{label}</Text>
      {cols.map((c) => <Text key={c} style={[styles.numCol, styles.th]}>{c}</Text>)}
    </View>
  );
}

function BattingTable({ innings, commonName }: { innings: PublicInnings; commonName: string | null }) {
  return (
    <View>
      <HeaderRow label="Batting" cols={BAT_COLS} />
      {innings.batsmen.length ? (
        innings.batsmen.map((b, idx) => (
          <View key={idx} style={styles.tr}>
            <View style={[styles.nameCol, styles.batCell]}>
              <Avatar name={b.name} role="batsman" size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.cellName} numberOfLines={1}>{b.name}</Text>
                  {commonName != null && b.name === commonName && <BothChip />}
                </View>
                <Text style={[styles.dismissal, !b.out && styles.notOut]}>
                  {b.out ? b.out.text : 'not out'}
                </Text>
              </View>
            </View>
            <Text style={styles.numCol}>{b.runs}</Text>
            <Text style={styles.numCol}>{b.balls}</Text>
            <Text style={styles.numCol}>{b.fours}</Text>
            <Text style={styles.numCol}>{b.sixes}</Text>
            <Text style={styles.numCol}>{fmtSR(b.runs, b.balls)}</Text>
          </View>
        ))
      ) : (
        <Hint style={{ paddingVertical: 8 }}>No one batted.</Hint>
      )}
    </View>
  );
}

function BowlingTable({ innings, commonName }: { innings: PublicInnings; commonName: string | null }) {
  return (
    <View>
      <HeaderRow label="Bowling" cols={BOWL_COLS} />
      {innings.bowlers.length ? (
        innings.bowlers.map((bw, idx) => (
          <View key={idx} style={styles.tr}>
            <View style={[styles.nameCol, styles.batCell]}>
              <Avatar name={bw.name} role="bowler" size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.cellName} numberOfLines={1}>{bw.name}</Text>
                  {commonName != null && bw.name === commonName && <BothChip />}
                </View>
              </View>
            </View>
            <Text style={styles.numCol}>{fmtOvers(bw.balls)}</Text>
            <Text style={styles.numCol}>{bw.maidens}</Text>
            <Text style={styles.numCol}>{bw.runs}</Text>
            <Text style={styles.numCol}>{bw.wickets}</Text>
            <Text style={styles.numCol}>{fmtEcon(bw.runs, bw.balls)}</Text>
          </View>
        ))
      ) : (
        <Hint style={{ paddingVertical: 8 }}>No one bowled.</Hint>
      )}
    </View>
  );
}

function InningsSection({ state, innings, index }: {
  state: PublicState;
  innings: PublicInnings;
  index: number;
}) {
  const team = state.config.teams[innings.battingTeamIndex];
  const x = innings.extras;
  const oversText = innings.oversDisplay ?? fmtOvers(innings.legalBalls);
  const batted = new Set(innings.batsmen.map((b) => b.playerIndex));
  const dnb = team.players.filter((_, pi) => !batted.has(pi));
  const commonName = state.config.commonPlayer ?? null;
  return (
    <Panel>
      <PanelTitle right={`${innings.runs}/${innings.wickets} (${oversText})`}>
        {index === 0 ? 'First innings' : 'Second innings'} — {team.name}
      </PanelTitle>
      <BattingTable innings={innings} commonName={commonName} />
      <Text style={styles.extrasLine}>
        Extras {x.total} (wd {x.wides}, nb {x.noballs}, b {x.byes}, lb {x.legbyes}) · Total{' '}
        <Text style={styles.subStrong}>{innings.runs}/{innings.wickets}</Text> in {oversText} overs
      </Text>
      {dnb.length > 0 && (
        <Hint style={{ marginBottom: 10 }}>Did not bat: {dnb.join(', ')}</Hint>
      )}
      <SheetSectionLabel>Fall of wickets</SheetSectionLabel>
      <View style={styles.fowList}>
        {innings.fallOfWickets.length ? (
          innings.fallOfWickets.map((w, idx) => (
            <Text key={idx} style={styles.fowRow}>
              <Text style={styles.subStrong}>{w.score}/{w.wicket}</Text> {w.batsmanName} · {w.over} ov
            </Text>
          ))
        ) : (
          <Hint>No wickets fell.</Hint>
        )}
      </View>
      <SheetSectionLabel>Bowling</SheetSectionLabel>
      <BowlingTable innings={innings} commonName={commonName} />
    </Panel>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 48 },
  wrap: { paddingHorizontal: 16 },

  resultBanner: {
    borderWidth: 1,
    borderColor: 'rgba(255, 169, 77, 0.6)',
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
    ...shadowSm,
  },
  resultText: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.apricotInk,
    textAlign: 'center',
  },
  breakLine: {
    textAlign: 'center',
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
    marginTop: -2,
    marginBottom: 16,
  },

  highlightCards: { gap: 10 },
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  highlightTitle: {
    fontSize: 11,
    color: colors.muted,
  },
  playerName: { fontWeight: '600', fontSize: 15, color: colors.text },
  playerSub: {
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.muted,
    marginTop: 2,
  },
  subStrong: { color: colors.text },

  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(240, 226, 204, 0.6)',
  },
  trHead: { borderBottomColor: colors.line },
  th: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
  nameCol: { flex: 1, minWidth: 0, paddingRight: 6 },
  numCol: {
    width: 42,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },
  batCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cellName: { fontSize: 14, color: colors.text, flexShrink: 1 },
  dismissal: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
  },
  notOut: { color: colors.apricotInk },

  extrasLine: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
    marginTop: 10,
    marginBottom: 4,
  },
  fowList: { gap: 4 },
  fowRow: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
  },
});
