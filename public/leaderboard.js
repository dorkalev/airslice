// Shared AIRSLICE leaderboard data layer used by the game (index.html) and the
// moderation page (admin.html). One place for Firebase config, App Check,
// run-name encoding, paginated fetching, and moderation helpers.
//
// SCALE: runs are named with an inverted, zero-padded score prefix so that
// Storage's lexicographic list() returns them already ranked highest-first.
// That lets the wall paginate (infinite scroll) instead of downloading every
// file's metadata up front — it never fetches more than one page at a time.

// deployment-specific values live in config.js (real) / config.example.js (placeholder)
export { FIREBASE_CONFIG, APPCHECK_SITE_KEY, CANON_HOST, ADMIN_EMAIL } from './config.js';
import { FIREBASE_CONFIG, APPCHECK_SITE_KEY } from './config.js';

const MAX_SCORE = 9_999_999;
const SCORE_PAD = 7;
const TS_PAD = 13;

// runs/<invScore7>_<ts13>_<sliced>f_x<combo>.<ext>
export function encodeRunName({ score, sliced, combo, ext }) {
  const s = Math.max(0, Math.min(MAX_SCORE, score | 0));
  const inv = String(MAX_SCORE - s).padStart(SCORE_PAD, '0');
  const ts = String(Date.now()).padStart(TS_PAD, '0');
  return `runs/${inv}_${ts}_${sliced | 0}f_x${combo | 0}.${ext}`;
}

export function parseRunName(name) {
  // ranked format only: <invScore7>_<ts13>_<sliced>f_x<combo>.<ext>
  // (older pre-launch test uploads use a different scheme and are ignored)
  const m = name.match(/^(\d{7})_(\d{13})_(\d+)f_x(\d+)\./);
  return m ? { score: MAX_SCORE - +m[1], sliced: +m[3], combo: +m[4], ts: +m[2] } : null;
}

let _fb = null;
export function getFirebase(useEmulator) {
  if (!_fb) _fb = (async () => {
    const [appMod, st, au, ac] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      APPCHECK_SITE_KEY
        ? import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js')
        : Promise.resolve(null),
    ]);
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
    if (ac && APPCHECK_SITE_KEY) {
      try {
        ac.initializeAppCheck(app, {
          provider: new ac.ReCaptchaV3Provider(APPCHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) { console.warn('App Check init failed', e); }
    }
    const storage = st.getStorage(app);
    const auth = au.getAuth(app);
    if (useEmulator) {
      st.connectStorageEmulator(storage, '127.0.0.1', 9199);
      au.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    // Reuse a persisted session (e.g. the admin's Google login, or a returning
    // player's anonymous id) — only sign in anonymously if there's truly none.
    // Blindly calling signInAnonymously() every load would clobber the admin's
    // Google session and force re-login on every page.
    try { await auth.authStateReady(); } catch {}
    if (!auth.currentUser) {
      try { await au.signInAnonymously(auth); } catch (e) { console.warn('anon auth failed', e); }
    }
    return { st, au, storage, auth, get uid() { return auth.currentUser?.uid ?? null; } };
  })();
  return _fb;
}

// One ranked page of runs (no download URLs yet — those load lazily/on hover).
export async function listPage(useEmulator, { pageToken = null, pageSize = 12 } = {}) {
  const { st, storage } = await getFirebase(useEmulator);
  const res = await st.list(st.ref(storage, 'runs'), { maxResults: pageSize, pageToken });
  const runs = res.items.map(item => {
    const p = parseRunName(item.name);       // parse the leaf name
    return p ? { item, name: item.name, path: item.fullPath, ...p } : null;
  }).filter(Boolean);                        // path (runs/…) is the identity used by isMine/rememberMine
  return { runs, nextPageToken: res.nextPageToken || null };
}

export async function getUrl(item) {
  const { st } = await getFirebase();
  return st.getDownloadURL(item);
}

// Tiny JPEG thumbnail per run (posters/<runBase>.jpg), shown instantly on the
// wall so cards don't wait on a multi-MB video download.
const posterPathFor = (runName) => 'posters/' + runName.replace(/\.[^.]+$/, '') + '.jpg';
export async function getPosterUrl(runName) {
  const { st, storage } = await getFirebase();
  try { return await st.getDownloadURL(st.ref(storage, posterPathFor(runName))); }
  catch { return null; }   // older runs have no poster → caller falls back
}
export async function uploadPoster(runName, blob) {
  const { st, storage, uid } = await getFirebase();
  if (!uid || !blob) return;
  await st.uploadBytes(st.ref(storage, posterPathFor(runName)), blob, {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000, immutable',
    customMetadata: { owner: uid },
  });
}
export async function deletePoster(runName) {
  const { st, storage } = await getFirebase();
  try { await st.deleteObject(st.ref(storage, posterPathFor(runName))); } catch {}
}

// Tiny animated preview (previews/<runName>) — a ~2s looping montage of the run,
// autoplayed on each card so the wall feels alive without loading full clips.
const previewPathFor = (runName) => 'previews/' + runName;
export async function getPreviewUrl(runName) {
  const { st, storage } = await getFirebase();
  try { return await st.getDownloadURL(st.ref(storage, previewPathFor(runName))); }
  catch { return null; }
}
export async function uploadPreview(runName, blob) {
  const { st, storage, uid } = await getFirebase();
  if (!uid || !blob) return;
  await st.uploadBytes(st.ref(storage, previewPathFor(runName)), blob, {
    contentType: blob.type || 'video/webm',
    cacheControl: 'public, max-age=31536000, immutable',
    customMetadata: { owner: uid },
  });
}
export async function deletePreview(runName) {
  const { st, storage } = await getFirebase();
  try { await st.deleteObject(st.ref(storage, previewPathFor(runName))); } catch {}
}

export async function deleteRun(item) {
  const { st } = await getFirebase();
  return st.deleteObject(item);
}

// Admin moderation: move a run out of runs/ into archived/ so it no longer
// shows on the wall (which only lists runs/), without destroying the file.
// Requires admin privileges per storage.rules.
export async function archiveRun(item) {
  const { st, storage } = await getFirebase();
  const [url, meta] = await Promise.all([st.getDownloadURL(item), st.getMetadata(item)]);
  const blob = await (await fetch(url)).blob();
  await st.uploadBytes(st.ref(storage, 'archived/' + item.name), blob, {
    contentType: meta.contentType || 'video/webm',
    customMetadata: meta.customMetadata || {},
  });
  await st.deleteObject(item);
}

// "Is this my run?" tracked locally (owner uid stays in file metadata for the
// security rule; we don't fetch per-item metadata just to render the wall).
const MINE_KEY = 'airslice-myruns';
const readMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; } };
export function rememberMine(path) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify([...readMine(), path].slice(-300))); } catch {}
}
export function forgetMine(path) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(readMine().filter(p => p !== path))); } catch {}
}
export function isMine(path) { return readMine().includes(path); }
