// API client for the Crixo Next.js backend.
//
// AUTH MODEL FOR MOBILE: cookies are unreliable in React Native, so the app
// uses the adminKey directly. The creation response's adminKey is stored in
// expo-secure-store (device keychain) per match, and rides along as
// body.adminKey on every event POST. The claim endpoint (204 on a valid key)
// doubles as key verification for the paste-key flow.
//
// ACCOUNTS: the app additionally holds a device session token
// (POST /api/session/register, stored in the keychain under 'crixo.session')
// and sends it as `Authorization: Bearer <token>` on every API call —
// including the SSE stream — so the backend knows which account this is
// (sign-in state, ad-free status, "your matches").

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { MatchConfig, MatchEvent, MatchLists, PublicState, UndoEvent } from './types';

// The Crixo backend. Fixed at build time — deliberately NOT user-configurable
// (a runtime override would let anyone point the app at an arbitrary server).
// Developers: change it here and rebuild.
export const DEFAULT_BASE_URL = 'https://crixo.duckdns.org';

const baseUrl = DEFAULT_BASE_URL;

export function getBaseUrl(): string {
  return baseUrl;
}

// ---------- fetch helper ----------

// Errors carry the HTTP status so callers can react to specific codes
// (the umpire console drops its stored admin key on 403).
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 12000;

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const auth = await sessionAuthHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(`Server at ${baseUrl} is not responding — check your connection and try again.`);
    }
    throw new ApiError(`Couldn't reach ${baseUrl} — is the backend running? (${(err as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null as T;
  let body: { error?: string } | null = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

// ---------- device session (accounts) ----------

// SecureStore-legal key (only [A-Za-z0-9._-] allowed).
const SESSION_TOKEN_KEY = 'crixo.session';

let sessionToken: string | null = null;
let sessionRegistration: Promise<string> | null = null;

// Returns the device's session token, registering one on first need:
// keychain first, then POST /api/session/register. Concurrent callers share
// a single in-flight registration; failure clears it so the next call
// retries (nothing broken is ever cached).
export async function ensureSessionToken(): Promise<string> {
  if (sessionToken) return sessionToken;
  if (!sessionRegistration) {
    sessionRegistration = registerSession().catch((err) => {
      sessionRegistration = null;
      throw err;
    });
  }
  return sessionRegistration;
}

async function registerSession(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    if (stored) {
      sessionToken = stored;
      return stored;
    }
  } catch { /* keychain unavailable — fall through and register */ }
  // Raw fetch (apiFetch would recurse back into ensureSessionToken), with
  // its own timeout so an unreachable server can't hang every API call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/session/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError(`Session registration failed (${res.status})`, res.status);
  const { token } = (await res.json()) as { token?: string };
  if (!token) throw new ApiError('Session registration returned no token.');
  sessionToken = token;
  try {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch { /* in-memory only this launch; a new token is registered next launch */ }
  return token;
}

// Best-effort Authorization header. If registration fails (server down,
// older backend without the endpoint) the call goes out without it — the
// real request then surfaces the meaningful error, and public endpoints
// keep working.
export async function sessionAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await ensureSessionToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

// ---------- endpoints ----------

export interface CreateMatchBody {
  teams: MatchConfig['teams'];
  oversPerInnings: number;
  battingFirstIndex: 0 | 1;
  commonPlayer: string | null;
  // Optional creation coordinates — with these the match shows up in the
  // "Live nearby" list of people within 500m. Never required.
  location?: { lat: number; lng: number };
}

// Account status for this device's session. signedIn flips after the Google
// browser sign-in attaches an identity to this session's bearer token;
// adFree flips after the one-time "Remove ads" purchase.
export interface Me {
  signedIn: boolean;
  email: string | null;
  // Google profile, null until sign-in (and when the id_token omits them).
  name: string | null;
  picture: string | null;
  adFree: boolean;
}

export function getMe(): Promise<Me> {
  return apiFetch('/api/me');
}

// Server-side monetization switches (GET /api/ads/config). Banners render
// only when this says showAds AND the account isn't ad-free; every purchase
// entry point ("Remove ads" button, Ad-free chip, remove-ads sheet) renders
// only when `purchases` — both are false when the server's monetization
// kill switch (MONETIZATION_ENABLED=false) is off.
export interface AdsConfig {
  showAds: boolean;
  purchases: boolean;
}

export function getAdsConfig(): Promise<AdsConfig> {
  return apiFetch('/api/ads/config');
}

// ---------- sign-in (Google via browser) ----------

// Mints a short-lived link code tied to this session's bearer token. The
// code rides along in the browser sign-in URL so the OAuth callback knows
// which app session to attach the Google identity to. Throws ApiError with
// status 429 when rate limited.
export function createLinkCode(): Promise<{ code: string; expiresIn: number }> {
  return apiFetch('/api/auth/link-code', { method: 'POST' });
}

// Browser page that runs Google OAuth, attaches the resulting identity to
// the link code's session, and lands on a "return to the app" page.
export function googleSignInUrl(linkCode: string): string {
  return `${baseUrl}/api/auth/google?link=${encodeURIComponent(linkCode)}`;
}

export function signOut(): Promise<{ ok: true }> {
  return apiFetch('/api/auth/signout', { method: 'POST' });
}

// ---------- payments (Razorpay hosted checkout) ----------

// One purchasable product. The ads model has a single pack:
// { id: 'adfree', credits: 0, amountPaise: 19900, label: 'Remove ads — one-time' }.
export interface PaymentPack {
  id: string;
  credits: number;
  amountPaise: number;
  label: string;
}

export function getPaymentsConfig(): Promise<{ keyId: string; packs: PaymentPack[] }> {
  return apiFetch('/api/payments/config');
}

// Throws ApiError with status 403 ('sign in to buy') when the session isn't
// signed in, and 502 when the payment provider rejects the server's keys.
export function createPaymentOrder(packId: string): Promise<{
  orderId: string;
  amountPaise: number;
  keyId: string;
  credits: number;
}> {
  return apiFetch('/api/payments/order', {
    method: 'POST',
    body: JSON.stringify({ packId }),
  });
}

// Hosted checkout page — completes the Razorpay payment in a browser sheet
// and marks the order's account ad-free server-side (this device's bearer,
// since the order was created with it). No native Razorpay SDK involved.
export function payPageUrl(orderId: string): string {
  return `${baseUrl}/pay/${encodeURIComponent(orderId)}`;
}

export function createMatch(body: CreateMatchBody): Promise<{ id: string; adminKey: string }> {
  return apiFetch('/api/matches', { method: 'POST', body: JSON.stringify(body) });
}

// `mine` = this session's matches; `nearby` = other people's live matches
// within discovery range of the given coords (each row carries distanceM;
// completed and own matches are excluded server-side). Without coords the
// backend returns an empty `nearby`.
export function listMatches(coords?: { lat: number; lng: number } | null): Promise<MatchLists> {
  const query = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
  return apiFetch(`/api/matches${query}`);
}

export function getMatch(id: string): Promise<PublicState> {
  return apiFetch(`/api/matches/${id}`);
}

export function postMatchEvent(
  id: string,
  event: MatchEvent | UndoEvent,
  adminKey: string | null,
): Promise<PublicState> {
  return apiFetch(`/api/matches/${id}/events`, {
    method: 'POST',
    body: JSON.stringify(adminKey ? { event, adminKey } : { event }),
  });
}

// 204 on a valid key (even without cookie persistence) — the mobile app uses
// this purely as key verification before storing the key locally.
export function claimMatch(id: string, adminKey: string): Promise<null> {
  return apiFetch(`/api/matches/${id}/claim`, {
    method: 'POST',
    body: JSON.stringify({ adminKey }),
  });
}

export function streamUrl(id: string): string {
  return `${baseUrl}/api/matches/${id}/stream`;
}

// ---------- admin key storage (device keychain) ----------

// SecureStore keys only allow [A-Za-z0-9._-], so the web's `crixo:<id>`
// namespace becomes `crixo.<id>` here (match ids are base36, always legal).
function keychainKey(matchId: string): string {
  return `crixo.${matchId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function getStoredAdminKey(matchId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keychainKey(matchId));
  } catch {
    return null;
  }
}

export async function storeAdminKey(matchId: string, adminKey: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keychainKey(matchId), adminKey);
  } catch { /* worst case: the umpire pastes the key again next session */ }
}

export async function deleteAdminKey(matchId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keychainKey(matchId));
  } catch { /* nothing to do */ }
}
