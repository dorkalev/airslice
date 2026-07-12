// Shared AIRSLICE leaderboard data layer — used by both the game (index.html)
// and the full wall (wall.html). One place for Firebase config, App Check,
// run-name encoding, and paginated fetching.
//
// SCALE: runs are named with an inverted, zero-padded score prefix so that
// Storage's lexicographic list() returns them already ranked highest-first.
// That lets the wall paginate (infinite scroll) instead of downloading every
// file's metadata up front — it never fetches more than one page at a time.

// Fill these in with your own Firebase web app config
// (Firebase console → Project settings → your web app). These are public
// client identifiers, not secrets — security comes from storage.rules + App
// Check, not from hiding them.
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  appId: 'YOUR_APP_ID',
};

// To turn on bot protection: create a reCAPTCHA v3 site key, register it under
// Firebase App Check for this web app, paste it here, then enable enforcement
// on Storage in the console. Left empty = App Check disabled (uploads still work).
export const APPCHECK_SITE_KEY = '';

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
    let uid = null;
    try { uid = (await au.signInAnonymously(auth)).user.uid; } catch (e) { console.warn('anon auth failed', e); }
    return { st, au, storage, auth, uid };
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

export async function deleteRun(item) {
  const { st } = await getFirebase();
  return st.deleteObject(item);
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
