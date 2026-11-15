/**
 * Strava: uploads watch workouts as activities. GPS workouts go up as GPX
 * (route, times, elevation and heart rate when recorded); workouts without a
 * route are created as manual activities.
 *
 * Needs a Strava API application (https://www.strava.com/settings/api):
 *   EXPO_PUBLIC_STRAVA_CLIENT_ID / EXPO_PUBLIC_STRAVA_CLIENT_SECRET in .env,
 *   "Authorization Callback Domain" set to `localhost`.
 * Tokens stay on the phone in the secure keystore.
 */
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type { GpsWorkoutRoute } from '../storage/types.ts';
import { exportGpsRoutesToGpx } from '../storage/exporters.ts';
import type { WorkoutSample } from './samples.ts';
import type { HealthTarget } from './types.ts';

const CLIENT_ID = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.EXPO_PUBLIC_STRAVA_CLIENT_SECRET ?? '';
export const STRAVA_REDIRECT_URI = 'com.nhumark.openultima://localhost/strava';
const TOKEN_KEY = 'ultima.strava.tokens';
const API = 'https://www.strava.com/api/v3';

interface Tokens { access_token: string; refresh_token: string; expires_at: number; athleteName?: string }

async function loadTokens(): Promise<Tokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

async function saveTokens(t: Tokens | null): Promise<void> {
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }).toString(),
  });
  const json = (await res.json()) as Tokens & { athlete?: { firstname?: string; lastname?: string }; message?: string };
  if (!res.ok || !json.access_token) throw new Error(json.message ? `Strava: ${json.message}` : 'Strava sign-in failed.');
  const name = json.athlete ? [json.athlete.firstname, json.athlete.lastname].filter(Boolean).join(' ') : undefined;
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at, ...(name ? { athleteName: name } : {}) };
}

async function accessToken(): Promise<string> {
  const t = await loadTokens();
  if (!t) throw new Error('Sign in to Strava first.');
  if (t.expires_at * 1000 > Date.now() + 60_000) return t.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  await saveTokens({ ...fresh, ...(t.athleteName ? { athleteName: t.athleteName } : {}) });
  return fresh.access_token;
}

export async function stravaAthleteName(): Promise<string | null> {
  return (await loadTokens())?.athleteName ?? null;
}

const SPORT: Record<WorkoutSample['activity'], string> = { run: 'Run', walk: 'Walk', ride: 'Ride', hike: 'Hike', other: 'Workout' };

/** Strava's upload `activity_type` (legacy field, still the one uploads honor). */
const UPLOAD_TYPE: Record<WorkoutSample['activity'], string> = { run: 'run', walk: 'walk', ride: 'ride', hike: 'hike', other: 'workout' };

function localStart(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Routes are resolved lazily so the adapter can build GPX from the stored waypoints. */
let routeLookup: (id: string) => GpsWorkoutRoute | undefined = () => undefined;
export function setStravaRouteLookup(fn: (id: string) => GpsWorkoutRoute | undefined): void {
  routeLookup = fn;
}

async function uploadGpx(token: string, s: WorkoutSample, route: GpsWorkoutRoute): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory ?? ''}strava-${route.id}.gpx`;
  await FileSystem.writeAsStringAsync(fileUri, exportGpsRoutesToGpx([route], route.id));
  const form = new FormData();
  form.append('file', { uri: fileUri, name: `${route.id}.gpx`, type: 'application/gpx+xml' } as never);
  form.append('data_type', 'gpx');
  form.append('name', s.name);
  form.append('activity_type', UPLOAD_TYPE[s.activity]);
  form.append('external_id', `ultima-${s.routeId}`);
  form.append('description', 'Recorded with an Ultima watch');
  const res = await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const json = (await res.json().catch(() => ({}))) as { error?: string | null; message?: string };
  if (!res.ok) throw new Error(json.message ?? `Strava upload failed (${res.status})`);
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
  if (json.error && !/duplicate/i.test(json.error)) throw new Error(json.error);
}

async function createManual(token: string, s: WorkoutSample): Promise<void> {
  const res = await fetch(`${API}/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: s.name, sport_type: SPORT[s.activity], start_date_local: localStart(s.start),
      elapsed_time: String(Math.max(1, Math.round(s.durationSec || (Date.parse(s.end) - Date.parse(s.start)) / 1000))),
      distance: String(Math.max(0, s.distanceMeters)), description: 'Recorded with an Ultima watch',
    }).toString(),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(json.message ?? `Strava rejected the activity (${res.status})`);
  }
}

export const stravaTarget: HealthTarget = {
  id: 'strava',
  name: 'Strava',
  kinds: new Set(['workout']),
  finishedDaysOnly: false,

  async availability() {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return { ok: false, reason: 'Add your Strava API app’s client ID and secret to .env to turn this on.', action: 'configure' };
    }
    return { ok: true };
  },

  async isConnected() {
    return (await loadTokens()) !== null;
  },

  async connect() {
    const url =
      'https://www.strava.com/oauth/mobile/authorize?' +
      new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: STRAVA_REDIRECT_URI, response_type: 'code', approval_prompt: 'auto', scope: 'activity:write,read' }).toString();
    const result = await WebBrowser.openAuthSessionAsync(url, STRAVA_REDIRECT_URI);
    if (result.type !== 'success') return false;
    const params = new URL(result.url).searchParams;
    const code = params.get('code');
    if (!code) throw new Error(params.get('error') === 'access_denied' ? 'You didn’t allow access.' : 'Strava sign-in failed.');
    if (!(params.get('scope') ?? '').includes('activity:write')) throw new Error('Allow “Upload your activities” so workouts can be added.');
    await saveTokens(await tokenRequest({ grant_type: 'authorization_code', code }));
    return true;
  },

  async disconnect() {
    const t = await loadTokens();
    if (t) {
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST', headers: { Authorization: `Bearer ${t.access_token}` },
      }).catch(() => undefined);
    }
    await saveTokens(null);
  },

  async write(samples, { sentBefore }) {
    const token = await accessToken();
    const stored: string[] = [];
    for (const s of samples) {
      if (s.kind !== 'workout') continue;
      // Strava has no update-by-id for uploads; a workout goes up once.
      if (sentBefore.has(s.key)) {
        stored.push(s.key);
        continue;
      }
      const route = routeLookup(s.routeId);
      if (route && route.waypoints.length >= 2) await uploadGpx(token, s, route);
      else await createManual(token, s);
      stored.push(s.key);
    }
    return stored;
  },
};
