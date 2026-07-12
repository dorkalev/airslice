# 🖐🍉 AIRSLICE

**Slice flying fruit in mid-air with your bare hands.** Your webcam tracks your
index finger and turns it into a blade — no controller, no mouse. All the hand
tracking runs **100% on-device in the browser** via
[LiteRT.js](https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/)
(WebGPU, with a WASM/XNNPACK fallback). Nothing about your camera leaves the
machine unless *you* choose to post a clip to the leaderboard.

▶️ **Play:** https://dorkalev-website.web.app/airslice/
🏆 **The Wall (leaderboard):** https://dorkalev-website.web.app/airslice/wall.html

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
  (`MediaRecorder`, ~1.2 Mbps) so clips stay small.
- **Leaderboard** — clips upload to Firebase Storage. Runs are named with an
  inverted, zero-padded score so Storage's lexicographic `list()` returns them
  already ranked, which lets the wall paginate (infinite scroll) instead of
  downloading everything. Top 3 autoplay; the rest load on hover.

## Project layout

```
public/
  index.html         the game
  wall.html          the leaderboard ("The Wall")
  leaderboard.js     shared Firebase + run data layer
  hand_landmark_full.tflite   MediaPipe hand model (Apache-2.0)
firebase.json        hosting + storage rules + emulator config
storage.rules        Storage security rules
```

## Run it yourself

You'll need your own [Firebase](https://firebase.google.com/) project (the
free Spark plan is enough to start).

1. Create a Firebase project. Enable **Storage** and **Anonymous
   Authentication**.
2. Put your web app's config into `public/leaderboard.js` (`FIREBASE_CONFIG`),
   and set your project id in `.firebaserc`.
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
  <25 MB, and stamps each file with the uploader's uid (only that uid can
  delete). Rules **cannot** rate-limit, so for anything public you should also
  enable **Firebase App Check** (set `APPCHECK_SITE_KEY` in `leaderboard.js`
  and turn on enforcement) and set a budget alert.

## License

This project's own code is [MIT](LICENSE). It uses LiteRT.js, the MediaPipe
hand-landmark model, the Firebase SDK, and Google Fonts under their respective
licenses — see [NOTICE](NOTICE).
