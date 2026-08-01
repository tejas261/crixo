// Home — hero, create-match form (roster rows with avatars), "Your matches"
// + "Live nearby" lists (expo-location), an ad banner, and the account row
// (sign-in / Google identity + ad-free status).

import { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  createMatch,
  DEFAULT_BASE_URL,
  getAdsConfig,
  getBaseUrl,
  getMe,
  listMatches,
  type Me,
  storeAdminKey,
} from '../src/api';
import { AccountSheet, RemoveAdsSheet } from '../src/components/AccountSheets';
import AccountAvatar from '../src/components/AccountAvatar';
import AdBanner from '../src/components/AdBanner';
import { CrixoMark } from '../src/components/CrixoLogo';
import Avatar, { EmptyStateArt } from '../src/components/Avatar';
import StatusChip from '../src/components/StatusChip';
import Sheet, { SheetSub, SheetTitle } from '../src/components/Sheet';
import { toast } from '../src/components/Toast';
import { PageBackground, SiteHeader } from '../src/components/Screen';
import { Btn, EmptyState, FieldLabel, Hint, Input, Panel, PanelTitle } from '../src/components/ui';
import { colors, fonts, radius } from '../src/theme';
import type { MatchListItem, MatchLists } from '../src/types';
// Location plumbing (lazy expo-location require + best-effort creation
// coordinates) lives in src/location.ts, shared with the Rematch buttons.
import { creationLocation, getLocationModule, type Coords, type LocPerm } from '../src/location';

export default function HomeScreen() {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [playersA, setPlayersA] = useState<string[]>([]);
  const [playersB, setPlayersB] = useState<string[]>([]);
  const [commonPlayer, setCommonPlayer] = useState('');
  const [overs, setOvers] = useState('10');
  // 'toss' = decide on the toss page after create (a provisional 0 is sent;
  // the toss event overrides battingFirstIndex when it's recorded).
  const [battingFirst, setBattingFirst] = useState<0 | 1 | 'toss'>(0);
  // Boom-boom over rule availability (armed per-over from the console).
  const [boomBoom, setBoomBoom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [lists, setLists] = useState<MatchLists | null>(null); // null = loading
  const [listError, setListError] = useState<string | null>(null);

  // Location: permission state drives the "Live nearby" panel (soft-ask
  // card / guidance / rows); coords ride along on list fetches and creates.
  const [locPerm, setLocPerm] = useState<LocPerm>('unknown');
  const [coords, setCoords] = useState<Coords | null>(null);

  // null = not loaded (account line stays minimal) — e.g. server unreachable
  // or an older backend without /api/me. Errors here are deliberately
  // silent; the ad-free chip is a quiet nicety, not a gate.
  const [me, setMe] = useState<Me | null>(null);
  // Server monetization switch — the header's "Ad-free" chip only makes
  // sense while purchases exist, so it hides when the server says off (or
  // the config can't be fetched).
  const [purchases, setPurchases] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [removeAdsOpen, setRemoveAdsOpen] = useState(false);

  const refreshList = useCallback((at?: Coords | null) => {
    listMatches(at ?? null)
      .then((fresh) => { setLists(fresh); setListError(null); })
      .catch((err: Error) => setListError(err.message));
  }, []);

  // Re-checks the permission, grabs coords when allowed, and refreshes the
  // lists with whatever position is available. Never throws.
  const refreshLocationAndList = useCallback(async () => {
    const Location = getLocationModule();
    if (!Location) {
      setLocPerm('unavailable');
      refreshList(null);
      return;
    }
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        setLocPerm(perm.canAskAgain ? 'undetermined' : 'denied');
        refreshList(null);
        return;
      }
      setLocPerm('granted');
      // Refresh the lists immediately with the last coords (or none) so the
      // panels don't wait on a GPS fix, then again once a position lands.
      refreshList(coords);
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(at);
      refreshList(at);
    } catch {
      // Position unavailable (airplane mode, simulator, …) — the earlier
      // coordless refresh already populated "Your matches".
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshList]);

  // The soft-ask card's button. (The system prompt can also fire from
  // "Start scoring" — see creationLocation — both are deliberate taps.)
  async function askForLocation() {
    const Location = getLocationModule();
    if (!Location) { setLocPerm('unavailable'); return; }
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        await refreshLocationAndList();
      } else {
        setLocPerm(perm.canAskAgain ? 'undetermined' : 'denied');
      }
    } catch {
      setLocPerm('unavailable');
    }
  }

  // Shared with the account/buy sheets — returns the fresh value so callers
  // (e.g. the payment poll) can compare balances.
  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const fresh = await getMe();
      setMe(fresh);
      return fresh;
    } catch {
      return null; // keep the last known state
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refreshLocationAndList();
    refreshMe();
    // Quietly re-check the monetization switch; failure means off.
    getAdsConfig()
      .then((c) => setPurchases(c.purchases === true))
      .catch(() => setPurchases(false));
  }, [refreshLocationAndList, refreshMe]));

  const mine = lists?.mine ?? [];
  const nearby = lists?.nearby ?? [];

  const oversNum = Number(overs);
  const common = commonPlayer.trim().replace(/\s+/g, ' ');
  const commonSize = common ? 1 : 0;
  const commonClashes = Boolean(common) &&
    [...playersA, ...playersB].some((p) => p.toLowerCase() === common.toLowerCase());
  const missing: string[] = [];
  if (!teamA.trim() || !teamB.trim()) missing.push('name both teams');
  if (playersA.length + commonSize < 2 || playersB.length + commonSize < 2) missing.push('add at least 2 players per side');
  if (commonClashes) missing.push(`pick a different common player (${common} is already in a squad)`);
  if (playersA.length + commonSize > 11 || playersB.length + commonSize > 11) {
    missing.push('squads are capped at 11 including the common player');
  }
  if (!Number.isInteger(oversNum) || oversNum < 1 || oversNum > 50) missing.push('set overs between 1 and 50');
  const formReady = missing.length === 0;
  const readyHint = `To start: ${missing.join(', ')}.`;

  async function onSubmit() {
    if (!formReady || submitting) return;
    Keyboard.dismiss();
    // The common player is a full member of both squads (batting last on
    // each side); config.commonPlayer records who they are for the badges.
    const body = {
      teams: [
        { name: teamA.trim(), players: common ? [...playersA, common] : playersA },
        { name: teamB.trim(), players: common ? [...playersB, common] : playersB },
      ] as [{ name: string; players: string[] }, { name: string; players: string[] }],
      oversPerInnings: oversNum,
      battingFirstIndex: (battingFirst === 'toss' ? 0 : battingFirst) as 0 | 1,
      commonPlayer: common || null,
      boomBoom,
      // Best-effort coordinates (see src/location.ts) — may ask for
      // permission right here, at the moment of intent.
      location: await creationLocation({
        coords,
        granted: locPerm === 'granted',
        onPermChange: setLocPerm,
      }),
    };
    setSubmitting(true);
    try {
      const { id, adminKey } = await createMatch(body);
      // The admin key is this device's scoring credential — keep it in the
      // keychain and send it with every event POST.
      await storeAdminKey(id, adminKey);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(battingFirst === 'toss' ? `/toss/${id}` : `/umpire/${id}`);
      // Reset the form for the next visit.
      setTeamA(''); setTeamB(''); setPlayersA([]); setPlayersB([]);
      setCommonPlayer(''); setOvers('10'); setBattingFirst(0); setBoomBoom(false);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageBackground>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <SiteHeader
          right={(
            <>
              {/* Quiet account row: ad-free status + who, tap for the sheet. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Account"
                onPress={() => setAccountOpen(true)}
                style={({ pressed }) => [styles.accountBtn, pressed && { opacity: 0.6 }]}
              >
                {purchases && me?.adFree && (
                  <Text style={styles.accountAdFree}>Ad-free</Text>
                )}
                {me?.signedIn ? (
                  <View style={styles.accountIdRow}>
                    <AccountAvatar name={me.name} email={me.email} picture={me.picture} size={24} />
                    <Text style={styles.accountWho} numberOfLines={1}>
                      {(me.name ?? me.email ?? 'Account').split(' ')[0]}
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={[styles.accountWho, styles.accountSignIn]}
                    numberOfLines={1}
                  >
                    Sign in
                  </Text>
                )}
              </Pressable>
            </>
          )}
        />
        <View style={styles.wrap}>
          <View style={styles.hero}>
            <View style={styles.heroRow}>
              <CrixoMark size={46} />
              <Text style={styles.heroTitle}>CRIXO</Text>
            </View>
            <Text style={styles.heroTag}>Ball-by-ball scoring for your match, live for everyone.</Text>
          </View>

          <Panel>
            <PanelTitle>Create a match</PanelTitle>

            <FieldLabel>Team A name</FieldLabel>
            <Input placeholder="Willowdale CC" value={teamA} onChangeText={setTeamA} />
            <Roster
              label="Team A"
              teamName={teamA}
              players={playersA}
              onChange={setPlayersA}
              commonName={common}
            />

            <FieldLabel>Team B name</FieldLabel>
            <Input placeholder="Oakfield XI" value={teamB} onChangeText={setTeamB} />
            <Roster
              label="Team B"
              teamName={teamB}
              players={playersB}
              onChange={setPlayersB}
              commonName={common}
            />

            <FieldLabel>Common player (optional)</FieldLabel>
            <Input
              placeholder="Odd headcount? They play for both sides"
              maxLength={40}
              autoCorrect={false}
              value={commonPlayer}
              onChangeText={setCommonPlayer}
            />
            {commonClashes && (
              <Text style={styles.rosterError}>
                {common} is already in a squad — remove them there, or use a different name here.
              </Text>
            )}

            <FieldLabel>Overs per innings</FieldLabel>
            <Input
              keyboardType="number-pad"
              value={overs}
              onChangeText={setOvers}
              maxLength={2}
            />

            <FieldLabel>Boom-boom overs</FieldLabel>
            <View style={styles.toggleRow}>
              <Btn
                title="Off"
                pressed={!boomBoom}
                onPress={() => setBoomBoom(false)}
                style={styles.toggleBtn}
                small
              />
              <Btn
                title="On"
                pressed={boomBoom}
                onPress={() => setBoomBoom(true)}
                style={styles.toggleBtn}
                small
              />
            </View>
            <Hint style={{ marginTop: 6 }}>
              Arm any over from the console: runs count double, every wicket costs 5.
            </Hint>

            <FieldLabel>Who bats first</FieldLabel>
            <View style={styles.toggleRow}>
              <Btn
                title={teamA.trim() || 'Team A'}
                pressed={battingFirst === 0}
                onPress={() => setBattingFirst(0)}
                style={styles.toggleBtn}
                small
              />
              <Btn
                title={teamB.trim() || 'Team B'}
                pressed={battingFirst === 1}
                onPress={() => setBattingFirst(1)}
                style={styles.toggleBtn}
                small
              />
              <Btn
                title="Toss decides"
                pressed={battingFirst === 'toss'}
                onPress={() => setBattingFirst('toss')}
                style={styles.toggleBtn}
                small
              />
            </View>

            <View style={{ marginTop: 20 }}>
              <Btn
                title={submitting ? 'Creating match…' : 'Start scoring'}
                variant="primary"
                disabled={!formReady}
                busy={submitting}
                onPress={onSubmit}
              />
              {!formReady && <Text style={styles.formHint}>{readyHint}</Text>}
              <Text style={styles.locationHint}>
                {locPerm === 'granted'
                  ? 'Your match will be discoverable by people within 500m.'
                  : locPerm === 'denied'
                    ? 'Allow location in Settings to make your match discoverable by people within 500m.'
                    : "We'll ask for location when you start, so people within 500m can find your match."}
              </Text>
            </View>
          </Panel>

          {/* Test banner (Google's test ids) — hidden for ad-free accounts,
              when the server turns ads off, or in builds without the native
              ads module. Never on the umpire console. */}
          <AdBanner adFree={me?.adFree} />

          <Panel>
            <PanelTitle>Your matches</PanelTitle>
            {listError ? (
              <EmptyState>Couldn&apos;t load matches — {listError}</EmptyState>
            ) : lists == null ? (
              <EmptyState>Loading matches…</EmptyState>
            ) : !mine.length ? (
              <View>
                <EmptyStateArt />
                <EmptyState>No matches yet — start one above.</EmptyState>
              </View>
            ) : (
              <View style={styles.matchList}>
                {mine.map((m) => <MatchRow key={m.id} match={m} mine />)}
              </View>
            )}
          </Panel>

          <Panel>
            <PanelTitle>Live nearby</PanelTitle>
            <NearbySection
              perm={locPerm}
              nearby={nearby}
              loaded={lists != null || listError != null}
              onAsk={askForLocation}
              onRetry={refreshLocationAndList}
            />
          </Panel>
        </View>
      </ScrollView>
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        me={me}
        refreshMe={refreshMe}
        onRemoveAds={() => {
          // Let the account modal finish dismissing before presenting the
          // purchase modal — concurrent RN Modal transitions glitch on iOS.
          setAccountOpen(false);
          setTimeout(() => setRemoveAdsOpen(true), 350);
        }}
      />
      <RemoveAdsSheet
        open={removeAdsOpen}
        onClose={() => setRemoveAdsOpen(false)}
        me={me}
        refreshMe={refreshMe}
      />
    </PageBackground>
  );
}

// ---------- live nearby ----------

// Body of the "Live nearby" panel: soft-ask card before permission is
// requested, guidance when it's denied/unavailable, otherwise the rows.
function NearbySection({ perm, nearby, loaded, onAsk, onRetry }: {
  perm: LocPerm;
  nearby: MatchListItem[];
  loaded: boolean;
  onAsk: () => void;
  onRetry: () => void;
}) {
  if (perm === 'undetermined' || perm === 'unknown') {
    // Soft ask — the OS prompt only appears after this deliberate tap.
    return (
      <View style={styles.nearbyAsk}>
        <Text style={styles.nearbyAskTitle}>Find matches near you</Text>
        <Text style={styles.nearbyAskBody}>
          See live gully matches around you and let people nearby watch yours.
          Location is used only while the app is open.
        </Text>
        <Btn title="Turn on location" variant="primary" small onPress={onAsk} />
      </View>
    );
  }
  if (perm === 'denied') {
    return (
      <View>
        <EmptyState>
          Location is off for Crixo. Allow it in your phone&apos;s Settings
          (Settings → Apps → Crixo → Location), then retry.
        </EmptyState>
        <Btn title="Retry" small onPress={onRetry} />
      </View>
    );
  }
  if (perm === 'unavailable') {
    return (
      <EmptyState>
        This build doesn&apos;t include location support — install the latest
        development build to see matches near you.
      </EmptyState>
    );
  }
  // granted
  if (!loaded) return <EmptyState>Looking for matches near you…</EmptyState>;
  if (!nearby.length) {
    return (
      <View>
        <EmptyState>
          No live matches nearby right now — matches started with location on
          appear here for anyone within 500m.
        </EmptyState>
        <Btn title="Refresh" small onPress={onRetry} />
      </View>
    );
  }
  return <View style={styles.matchList}>{nearby.map((m) => <MatchRow key={m.id} match={m} />)}</View>;
}

// ---------- roster builder ----------

interface RosterProps {
  label: string;
  teamName: string;
  players: string[];
  onChange: (players: string[]) => void;
  commonName: string;
}

function Roster({ label, teamName, players, onChange, commonName }: RosterProps) {
  const [draft, setDraft] = useState('');
  const [dupe, setDupe] = useState<string | null>(null);

  const clean = draft.trim().replace(/\s+/g, ' ');
  const commonSize = commonName ? 1 : 0;
  const count = players.length + commonSize;
  const full = count >= 11;

  function add() {
    if (!clean) return;
    const clash = players.some((p) => p.toLowerCase() === clean.toLowerCase())
      || (commonName && clean.toLowerCase() === commonName.toLowerCase());
    if (clash) {
      setDupe(`${clean} is already in this squad.`);
      return;
    }
    if (full) {
      setDupe('Squads are capped at 11.');
      return;
    }
    onChange([...players, clean]);
    setDraft('');
    setDupe(null);
  }

  return (
    <View style={styles.roster}>
      <View style={styles.rosterHead}>
        <Text style={styles.rosterLabel}>{teamName.trim() || label} players</Text>
        <Text style={[styles.rosterCount, count >= 2 && count <= 11 && styles.rosterCountOk]}>
          {count}/11
        </Text>
      </View>
      <View style={styles.rosterInputRow}>
        <Input
          placeholder="Add a player"
          value={draft}
          onChangeText={(t) => { setDraft(t); setDupe(null); }}
          onSubmitEditing={add}
          blurOnSubmit={false}
          autoCorrect={false}
          returnKeyType="done"
          style={{ flex: 1 }}
        />
        <Btn title="Add" onPress={add} disabled={!clean} small />
      </View>
      {dupe && <Text style={styles.rosterError}>{dupe}</Text>}
      {players.length === 0 && !commonName && (
        <Hint style={{ marginTop: 6 }}>Batting order = the order you add them (2–11).</Hint>
      )}
      <View style={styles.rosterList}>
        {players.map((p, idx) => (
          <View key={`${p}:${idx}`} style={styles.rosterChip}>
            <Text style={styles.rosterOrder}>{idx + 1}</Text>
            <Avatar name={p} role="batsman" size={26} />
            <Text style={styles.rosterName} numberOfLines={1}>{p}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${p}`}
              onPress={() => onChange(players.filter((_, i) => i !== idx))}
              style={styles.rosterX}
            >
              <Text style={styles.rosterXText}>×</Text>
            </Pressable>
          </View>
        ))}
        {commonName ? (
          <View style={[styles.rosterChip, styles.rosterChipCommon]}>
            <Text style={styles.rosterOrder}>{players.length + 1}</Text>
            <Avatar name={commonName} role="batsman" size={26} />
            <Text style={styles.rosterName} numberOfLines={1}>{commonName}</Text>
            <Text style={styles.rosterCommonNote}>both sides</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------- match rows ----------

// Finished matches land on the scorecard; nearby (other people's) matches
// on the live view. Your own unfinished matches resume the umpire console —
// the adminKey in the keychain (stored at create) makes it scoreable, and
// the console's paste-key fallback covers everything else.
function MatchRow({ match: m, mine = false }: { match: MatchListItem; mine?: boolean }) {
  const done = m.status === 'completed';
  const resume = mine && !done;
  const href = done ? `/summary/${m.id}` : resume ? `/umpire/${m.id}` : `/m/${m.id}`;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.matchRow, pressed && { transform: [{ scale: 0.99 }] }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.matchTeams} numberOfLines={1}>{m.teams.join(' v ')}</Text>
        {m.distanceM != null && (
          <Text style={styles.matchDistance}>~{Math.round(m.distanceM)}m away</Text>
        )}
      </View>
      <Text style={styles.matchScore}>{m.result ? m.result : (m.score || '')}</Text>
      {resume && <Text style={styles.matchResume}>Score ›</Text>}
      <StatusChip status={m.status} />
    </Pressable>
  );
}


// ---------- styles ----------

const styles = StyleSheet.create({
  scroll: { paddingBottom: 48 },
  wrap: { paddingHorizontal: 16 },
  hero: { paddingTop: 16, paddingBottom: 22 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 42,
    letterSpacing: 0.5,
    color: colors.apricotInk,
  },
  heroTag: {
    color: colors.muted,
    marginTop: 8,
    fontSize: 16,
  },

  accountBtn: { alignItems: 'flex-end', maxWidth: 160 },
  accountAdFree: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.apricotInk,
  },
  accountWho: { fontSize: 13, color: colors.muted, marginTop: 1, flexShrink: 1 },
  accountSignIn: { color: colors.apricotInk, fontWeight: '600' },
  // Signed in: 24px Google avatar + first name.
  accountIdRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },

  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleBtn: { flexGrow: 1, flexBasis: '30%' },
  formHint: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 12.5,
    color: colors.muted,
  },
  locationHint: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 12,
    color: colors.muted,
  },

  nearbyAsk: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: 12,
    gap: 8,
  },
  nearbyAskTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  nearbyAskBody: { fontSize: 12.5, color: colors.muted, marginBottom: 2 },

  roster: { marginTop: 6 },
  rosterHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  rosterLabel: { fontSize: 13, color: colors.muted },
  rosterCount: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted },
  rosterCountOk: { color: colors.apricotInk },
  rosterInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rosterError: { fontSize: 12.5, color: colors.danger, marginTop: 6 },
  rosterList: { marginTop: 10, gap: 6 },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
  },
  rosterChipCommon: { backgroundColor: colors.butterPale },
  rosterOrder: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
    minWidth: 14,
    textAlign: 'right',
  },
  rosterName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  rosterCommonNote: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.apricotInk,
  },
  rosterX: { paddingHorizontal: 8, paddingVertical: 2 },
  rosterXText: { fontSize: 18, color: colors.muted, lineHeight: 20 },

  matchList: { gap: 10 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  matchTeams: {
    fontWeight: '600',
    fontSize: 14,
    color: colors.text,
  },
  matchDistance: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.apricotInk,
    marginTop: 2,
  },
  matchScore: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
    flexShrink: 1,
  },
  // "Score ›" resume affordance on your own unfinished matches.
  matchResume: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.apricotInk,
  },
});
