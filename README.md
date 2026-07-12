# 🖐🍉 AIRSLICE

**Slice flying fruit in mid-air with your bare hands.** Your webcam tracks your
index finger and turns it into a blade — no controller, no mouse. All the hand
tracking runs **100% on-device in the browser** via
[LiteRT.js](https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/)
(WebGPU, with a WASM/XNNPACK fallback). Nothing about your camera leaves the
machine unless *you* choose to post a clip to the leaderboard.

▶️ **Play (with the 🏆 leaderboard right on the page):**
https://airslice.dorkalev.com/

## How it plays

- **Slice** — swing your index finger through the fruit. Multi-fruit swipes
  build combos.
- **Avoid the 🪨** — slicing a rock costs points.
- **60 seconds** per run, then post your clip to the public wall (optional) or
  save it locally.
- **No webcam?** There's a mouse/touch fallback mode.

## How it works

```
webcam ─▶ ROI crop 224×224 ─▶ LiteRT.js (hand_landmark_full.tflite)
       ─▶ 21 hand landmarks ─▶ index-fingertip blade ─▶ slice detection
```

- **On-device inference** — `@litertjs/core` runs the MediaPipe hand-landmark
  model in the tab. WebGPU when available, WASM otherwise.
- **Recording** — each run is captured from a downscaled canvas
  (`MediaRecorder`, 480p / ~800 kbps) so clips stay small.
- **Leaderboard** — clips upload to Firebase Storage. Runs are named with an
  inverted, zero-padded score so Storage's lexicographic `list()` returns them
  already ranked, which lets the wall paginate (infinite scroll) with no
  database. Each card autoplays a tiny generated **preview loop**; the full clip
  opens in a modal on click.

## Project layout

```
public/
  index.html         the game + the leaderboard ("The Wall") + clip viewer, one page
  admin.html         owner-only moderation page (served at /admin)
  leaderboard.js     shared Firebase + run data layer
  hand_landmark_full.tflite   MediaPipe hand model (Apache-2.0)
functions/
  index.js           Cloud Function: notify a webhook on each upload
firebase.json        hosting + storage rules + functions + emulator config
storage.rules        Storage security rules
```

The leaderboard lives on the home screen (below the start buttons) and uses
paginated infinite scroll — the top 3 runs autoplay, the rest load their video
on hover. The 🏆 button and the post-game screen scroll you to it. Each card has
a 🔗 button that copies a permalink (`?clip=<path>`) which opens that clip in a
focused viewer.

### Moderation — `/admin`

`admin.html` (served at `/admin` via a hosting rewrite) is an owner-only page:
sign in with Google, and if your email matches the admin email in
`storage.rules` (`isAdmin()`) you get every run with **Archive** (move it out of
`runs/` into `archived/` so it leaves the wall but is kept) and **Delete**
(permanent) buttons. Set your own admin email in `storage.rules` and
`admin.html`, and enable the Google provider (add your hosting domain to the
Auth **authorized domains**).

### Upload notifications

`functions/index.js` is a Storage-triggered Cloud Function (needs the Blaze
plan) that posts to a Slack or Discord webhook whenever a run is uploaded. Set
your bucket in `functions/index.js`, then:
```bash
firebase functions:secrets:set NOTIFY_WEBHOOK_URL   # paste your webhook URL
firebase deploy --only functions
```

## Run it yourself

You'll need your own [Firebase](https://firebase.google.com/) project (the
free Spark plan is enough to start).

1. Create a Firebase project. Enable **Storage** and **Anonymous
   Authentication**.
2. Fill in **`public/config.js`** (Firebase web config, optional App Check site
   key, canonical host, admin email) and set your project id in `.firebaserc`.
   All deployment-specific values live in that one file.
3. Deploy:
   ```bash
   npm i -g firebase-tools
   firebase deploy --only storage,hosting
   ```

Local dev with the emulators (needs Java 21+):
```bash
firebase emulators:start --only storage,auth
# then serve ./public and open /index.html?emu=1
```

### Security notes

- The Firebase `apiKey` in `leaderboard.js` is a **public client identifier**,
  not a secret — safety comes from the rules, not from hiding it.
- `storage.rules` restricts uploads to signed-in users, video content types,
  <25 MB, and stamps each file with the uploader's uid (only that uid or the
  admin can delete) — all **server-enforced**, not client trust.
- Rules **cannot** rate-limit, so the Cloud Function enforces a **per-uploader
  daily cap** server-side (a counter object under `counters/`; over-cap uploads
  are deleted). Also enable **Firebase App Check** (set `APPCHECK_SITE_KEY` in
  `config.js`, register the reCAPTCHA secret, then Monitor → Enforce) and set a
  budget alert.
- Client-side bits (canonical redirect, "my run" ownership UI) are UX only —
  never rely on them for security.

---

# Product spec — rebuild reference

Everything the game does, as buildable requirements. (An agent can implement
from this list without re-deriving it.)

### Core gameplay
- Webcam-driven game: the player's **index fingertip is a blade**; swiping it
  through flying fruit slices them. All hand tracking is **on-device in the
  browser** (no server, no upload for gameplay).
- Fruit spawn in arcs (physics: gravity, rotation, varied launch); spawn rate
  ramps up over the run.
- **Slice detection**: a fast fingertip stroke that passes through a fruit cuts
  it (blade trail drawn behind the fingertip). Cut fruit splits into two
  spinning halves + juice particles.
- **Combos**: slicing multiple fruit in one stroke stacks a combo multiplier and
  bonus points, with a floating "COMBO ×N" popup.
- **Hazard**: a rock 🪨 (not a bomb — deliberately distinct from Fruit Ninja);
  slicing it subtracts points and shakes the screen.
- **Timed run**: 60 seconds (overridable via `?t=<seconds>`). Last-5-seconds
  countdown ticks.
- **Countdown gate**: after Start, a 3-2-1 countdown; in camera mode it waits
  ("✋ SHOW ME YOUR HAND") until a hand is actually detected. If the hand is
  lost mid-run, the game pauses ("HAND LOST — PAUSED") instead of losing time.
- **Score / best / stats**: live score + timer HUD; personal best persisted in
  `localStorage`; end screen shows score, sliced count, top combo, best.
- **No-camera fallback**: a mouse/touch mode so anyone can play (and shared
  links never dead-end).
- **Legally distinct** from Fruit Ninja: own name/art, rock hazard, emoji fruit,
  generic mechanics.

### Ending a run
- End anytime with **Space / Enter / Esc**, or the 🏆 button, which opens a
  **confirmation modal** (game pauses): **END & POST**, **just end**, or **KEEP
  PLAYING** (Esc = keep playing).
- Score/stats are **frozen at the instant the run ends** (a later async upload
  can't post a stale/zeroed score).

### Posting & consent
- Uploading a clip is **opt-in** — nothing about the camera leaves the device
  unless the player explicitly posts. The consent copy states the clip
  (camera footage included) becomes public.
- Each run is **recorded** (the composited canvas: mirrored camera + gameplay
  overlay) as a small video; the player sees a **replay** before deciding.
- On post → the game **auto-jumps to the wall and opens the run's modal on top**.
- The player can **save the clip locally** or **copy a brag link** instead.

### The Wall (leaderboard) — on the home page
- Single page: the leaderboard lives **on the home screen** (below the start
  buttons); there is no separate wall page.
- **Ranked by score**, **infinite scroll**, **no database**.
- Every card shows an **animated preview loop** (tiny, autoplaying) over an
  instant static poster frame; **top 3 get medal styling, #1 a crown**.
- Card actions: **🔗 copy permalink** and **📤 share**. Clicking a card opens a
  **modal** with the full clip.
- **Permalinks**: `?clip=<path>` opens that clip's modal directly (shareable
  deep link). The modal has one uniform action row: **Share · Copy link · Back
  to Wall · Play** (Play starts a new run), plus a prominent ✕.
- The home wall doubles as **consent transparency** — visitors see real players'
  captured clips, making it obvious that posting publishes your webcam footage.
- **Owner self-removal**: a player can delete their own posted clip from the
  same browser they posted from.

### Moderation — `/admin`
- Owner-only page at **`/admin`**. Shows **nothing** but a Google sign-in until
  the specific admin email is signed in (and email-verified).
- The admin session **persists** (no re-login on every page load).
- Lists **every** run with infinite scroll and a **sort toggle: top score /
  most recent**. Cards use the same animated preview; click opens the full clip.
- Two moderation actions per clip: **Archive** (move out of the wall but keep
  the file) and **Delete** (permanent). Both clean up the clip's thumbnails.

### Notifications
- The owner gets a **Slack/Discord ping on every upload** (score, sliced, combo,
  size) via a Storage-triggered Cloud Function. The webhook URL is a secret.

### Audio
- **Slice SFX**: a satisfying blade "slash" on every cut; boom on rock/miss.
- **Ambient background music**: generated in-browser (no audio files), starts on
  the **first user interaction anywhere**, plays continuously, obeys a 🔊/🔇
  mute toggle.

### Hosting, domain & distribution
- Self-contained on its **own Firebase project** (hosting + storage + auth +
  functions), served from a **custom subdomain**.
- **Canonical-domain redirect**: any other host is bounced to the canonical
  domain, preserving the full route (path + query + hash).
- **Footer** credits the author (link) + the source repo (link).
- Open-source (MIT), public config placeholders, deps credited in NOTICE.

### Security & cost controls
- Storage rules gate uploads (signed-in, video-only, size-capped, owner-stamped;
  only owner/admin can delete).
- **App Check** (reCAPTCHA v3) for bot protection; **budget alert** as a cost
  backstop; immutable cache headers so repeat views are free.

---

# Technical playbook — the tricks

The non-obvious techniques that make the above work. This is the "how", so a
rebuild doesn't have to rediscover them.

### Hand tracking
- **Browser on-device inference**: `@litertjs/core` (LiteRT.js) runs MediaPipe
  `hand_landmark_full.tflite`; pick `webgpu`, fall back to `wasm` on compile
  error. WASM binaries + model are same-origin (no remote-code issues).
- **ROI tracking**: crop a square region to 224×224 for the model; each frame,
  recompute the region from the previous frame's landmark bounding box expanded
  ~2.4× (MediaPipe's tracking trick); full-frame rescan when presence drops.
- **Smoothing + mapping**: exponential-moving-average the landmarks; map the
  index-fingertip from the cover-fit, mirrored video into screen space for the
  blade.
- **Loop**: inference in a `requestAnimationFrame` loop; slice test = segment
  distance from the previous fingertip to the current vs each fruit radius,
  gated on stroke speed.

### Leaderboard without a database (the core trick)
- **Rank-in-the-filename**: name each run `runs/<invScore7>_<ts13>_<sliced>f_x<combo>.<ext>`
  where `invScore = 9999999 - score`, zero-padded. Storage's `list()` returns
  objects in **lexicographic name order**, so they come back **already ranked by
  score**, newest-first on ties.
- **Paginate** with `list({ maxResults, pageToken })` + an IntersectionObserver
  sentinel → true infinite scroll, fetching one page at a time.
- **Parse stats from the name** (score/sliced/combo/ts) → the wall needs **no
  per-item metadata reads**, which keeps it cheap at scale.
- **Ownership via `localStorage`** (list of your own paths), not per-item
  metadata — so rendering the wall stays a single `list()` call. The security
  rule still enforces real ownership via the file's `owner` metadata.

### Recording & instant thumbnails
- **Record** from a downscaled mirror canvas via `canvas.captureStream()` +
  `MediaRecorder` (480p, ~800 kbps). Each recording keeps its chunks in a
  **closure** so a new run can't corrupt a still-uploading one.
- **Static poster**: `canvas.toBlob('image/jpeg')` of the final frame → used as
  the `<video poster>` for an instant first paint.
- **Animated preview (browser-generated, no GIF lib)**: sample ~16 frames across
  the run into a ring buffer; at end, **re-encode** them by drawing to a small
  canvas and recording its `captureStream` at ~9 fps → a ~100 KB looping
  webm/mp4. Cards autoplay this; the multi-MB full clip loads only on click.
- **Lazy media**: resolve `getDownloadURL` lazily; cards load the tiny
  preview/poster, never the full clip, until the modal opens.
- **`Cache-Control: public, max-age=31536000, immutable`** on every upload →
  browser/edge caching makes repeat views instant and cheap (poor-man's CDN).

### Auth
- **Anonymous auth for players**, but **reuse the persisted session** — await
  `auth.authStateReady()` and only `signInAnonymously` if there's no current
  user. (Blindly signing in anonymously every load *wipes the admin's Google
  session* → the "re-auth every page" bug.)
- **Admin = Google sign-in**; rules authorize by
  `request.auth.token.email == '<admin>' && email_verified`. Hosting the app on
  the **same project** as Auth avoids cross-project authorized-domain pain.

### Storage rules
- `create`: `auth != null` + `contentType.matches('video/(webm|mp4)(;.*)?')`
  (the codec-suffix `(;.*)?` matters — `video/webm;codecs=vp9` must pass) +
  size cap + `metadata.owner == request.auth.uid`.
- `delete`: owner **or** `isAdmin()`. Separate `posters/`, `previews/` (public
  read, small) and `archived/` (admin-only) prefixes.
- **Archive without delete**: client downloads the blob and re-uploads it to
  `archived/`, then deletes the original — it leaves `runs/` (so the wall, which
  only lists `runs/`, stops showing it) but is preserved and admin-readable.

### Cloud Function (notifications)
- 2nd-gen `onObjectFinalized` Storage trigger → POST to a webhook. **Its region
  must match the bucket's region** or deploy fails. Webhook URL is a
  `defineSecret` (Secret Manager), never in code. Auto-detect Slack (`{text}`)
  vs Discord (`{content}`) by URL. Set an Artifact Registry cleanup policy so
  build images don't accrue cost.

### Audio (no assets)
- All sound is **synthesized** with the Web Audio API — SFX (filtered-noise
  slash, oscillator boom/blip) and a **generative music loop** (lookahead
  scheduler: bass + sub + square arpeggio + hi-hat over a minor progression).
- **Unlock the right way** (per howler.js): browsers block audio until a
  gesture, and on iOS/Safari `resume()` alone isn't enough — you must **play a
  1-sample silent buffer inside the gesture**. Also handle `onstatechange` and
  `visibilitychange` to auto-resume after interruptions, and attempt the unlock
  on *any* gesture type (`click`/`pointerup`/`touchend`/`pointerdown`/`keydown`).

### Hosting & domain
- **Cross-project**: Firebase can't natively serve a *path* of one project's
  domain from another project — so the game lives on its own project + subdomain
  and the old `/airslice` path is a **301 redirect** to it.
- **Client canonical guard**: a tiny inline script redirects any non-allow-listed
  host to the canonical domain (keeping path+query+hash); a blank `CANON`
  disables it for open-source forks.
- **No-cache HTML/JS** hosting headers so deploys apply immediately (with a
  cache-busting import query when needed).

### Rebuilding / testing
- Verify against the **Firebase emulators** (storage + auth). To exercise
  admin/auth flows headlessly, mint a fabricated **verified Google identity** in
  the Auth emulator via `signInWithCredential(GoogleAuthProvider.credential(
  JSON.stringify({ sub, email, email_verified: true })))`.
- Drive gameplay tests with a **fake camera** (a `<canvas>.captureStream()` fed a
  hand image) so uploads, previews, and the wall can be verified end-to-end.

---

## License

This project's own code is [MIT](LICENSE). It uses LiteRT.js, the MediaPipe
hand-landmark model, the Firebase SDK, and Google Fonts under their respective
licenses — see [NOTICE](NOTICE).
