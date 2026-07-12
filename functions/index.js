// AIRSLICE Cloud Functions (server-side, cannot be bypassed by the client).
//  - Rate-limits uploads per uploader per day and deletes anything over the cap.
//  - Notifies a Slack/Discord webhook on each accepted run.
// The webhook URL is a secret:  firebase functions:secrets:set NOTIFY_WEBHOOK_URL

const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const NOTIFY_WEBHOOK_URL = defineSecret("NOTIFY_WEBHOOK_URL");
const BUCKET = "YOUR_PROJECT.firebasestorage.app";
const CANONICAL = "https://YOUR_DOMAIN";
const DAILY_CAP = 40;               // max posted runs per uploader per (UTC) day

const bucket = () => admin.storage().bucket(BUCKET);

async function readCount(file) {
  try { const [buf] = await file.download(); return parseInt(buf.toString(), 10) || 0; }
  catch { return 0; }               // not found → 0
}

exports.notifyOnUpload = onObjectFinalized(
  { bucket: BUCKET, secrets: [NOTIFY_WEBHOOK_URL], region: "us-east1", memory: "256MiB" },
  async (event) => {
    const path = event.data.name || "";
    if (!path.startsWith("runs/")) return;   // ignore posters/previews/counters

    const owner = (event.data.metadata && event.data.metadata.owner) || "";
    const leaf = path.slice(5);

    // Only our ranked runs count/notify. Anything else in runs/ is anomalous
    // (the client only ever writes this format) → ignore it entirely.
    const m = leaf.match(/^(\d{7})_(\d{13})_(\d+)f_x(\d+)(?:_n([a-z0-9]{1,12}))?\./);
    if (!m) { logger.warn(`ignoring unranked run name: ${leaf}`); return; }

    // ---- server-side rate limit (per uploader per UTC day) ----
    // The Storage rule requires metadata.owner == uid on create, so owner is
    // present for every legit upload; a "noowner" fallback caps anything that
    // somehow slips through rather than letting it past unmetered.
    {
      const day = new Date(event.data.timeCreated || Date.now()).toISOString().slice(0, 10);
      const counter = bucket().file(`counters/${owner || "noowner"}_${day}`);
      const n = (await readCount(counter)) + 1;
      try { await counter.save(String(n), { contentType: "text/plain", resumable: false }); } catch (e) { logger.error("counter write", e); }
      if (n > DAILY_CAP) {
        // over the cap → remove this run + its thumbnails, don't notify
        const base = leaf.replace(/\.[^.]+$/, "");
        await Promise.allSettled([
          bucket().file(path).delete(),
          bucket().file(`posters/${base}.jpg`).delete(),
          bucket().file(`previews/${leaf}`).delete(),
        ]);
        logger.warn(`rate limit: ${owner || "noowner"} over ${DAILY_CAP}/day — deleted ${path}`);
        return;
      }
    }

    // ---- notify ----
    const score = 9999999 - parseInt(m[1], 10);
    const sliced = m[3];
    const combo = m[4];
    const who = m[5] ? ` by @${m[5]}` : "";
    const sizeMB = event.data.size ? (Number(event.data.size) / 1048576).toFixed(1) : "?";
    const msg = `🍉 New AIRSLICE run${who}: ${score} pts (${sliced} sliced, combo x${combo}) · ${sizeMB} MB`;

    const url = NOTIFY_WEBHOOK_URL.value();
    if (!url) { logger.warn("NOTIFY_WEBHOOK_URL is empty"); return; }
    const isDiscord = url.includes("discord.com") || url.includes("discordapp.com");
    const body = isDiscord ? { content: msg } : { text: msg };
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) logger.error("webhook non-2xx", res.status, await res.text());
    } catch (e) { logger.error("webhook error", e); }
  }
);

// ---- rich link unfurls: /c/<runLeaf> serves OpenGraph HTML to crawlers and
// redirects humans to the in-app clip modal. Media URLs are tokened download
// URLs (crawler-fetchable, no App Check needed). ----
async function mediaUrl(path) {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  let token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
  if (token) token = String(token).split(",")[0];
  else { token = crypto.randomUUID(); await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } }); }
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

exports.clipPage = onRequest({ region: "us-central1", memory: "256MiB" }, async (req, res) => {
  const slug = decodeURIComponent((req.path || "").replace(/^\/c\/?/, "").replace(/^\/+/, ""));

  // Resolve the slug → a real run leaf. Two accepted forms:
  //   pretty (what the app shares):  [<name>-]<score>-<ts36>   e.g. dor-540-le8k2p1
  //   raw storage key (old/direct):  <inv7>_<ts13>_<n>f_x<c>[_n<name>].<ext>
  const rawRe = /^(\d{7})_(\d{13})_(\d+)f_x(\d+)(?:_n([a-z0-9]{1,12}))?\.(webm|mp4)$/;
  let leaf = null;
  if (rawRe.test(slug)) {
    leaf = slug;                                     // old link or direct key
  } else {
    const pm = slug.match(/^(?:[a-z0-9]{1,12}-)?(\d{1,7})-([0-9a-z]{1,9})$/);
    if (pm) {
      // score+timestamp is unique → a single prefix lookup finds the object
      const inv = String(Math.max(0, 9999999 - parseInt(pm[1], 10))).padStart(7, "0");
      const ts = String(parseInt(pm[2], 36)).padStart(13, "0");
      try {
        const [files] = await bucket().getFiles({ prefix: `runs/${inv}_${ts}`, maxResults: 1 });
        if (files && files[0]) leaf = files[0].name.slice(5);
      } catch (e) { logger.error("slug resolve", e); }
    }
  }
  const m = leaf && leaf.match(rawRe);
  if (!m) { res.redirect(302, CANONICAL); return; }

  const score = 9999999 - parseInt(m[1], 10), sliced = m[3], combo = m[4];
  // canonical share URL is always the pretty form
  const prettyUrl = `${CANONICAL}/c/${m[5] ? m[5] + "-" : ""}${score}-${parseInt(m[2], 10).toString(36)}`;
  const appUrl = `${CANONICAL}/?clip=` + encodeURIComponent("runs/" + leaf);
  const who = m[5] ? "@" + m[5] : "a player";
  const base = leaf.replace(/\.[^.]+$/, "");
  let posterUrl = null, clipMediaUrl = null;
  try { [posterUrl, clipMediaUrl] = await Promise.all([mediaUrl(`posters/${base}.jpg`), mediaUrl(`runs/${leaf}`)]); }
  catch (e) { logger.error("mediaUrl", e); }

  const title = `${score} pts on AIRSLICE 🍉`;
  const desc = `${who} sliced ${sliced} fruit (combo x${combo}) with their bare hands — think you can beat it?`;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const vtype = m[6] === "mp4" ? "video/mp4" : "video/webm";

  res.set("Cache-Control", "public, max-age=3600");
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="AIRSLICE">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${prettyUrl}">
${posterUrl ? `<meta property="og:image" content="${esc(posterUrl)}"><meta property="og:image:width" content="400"><meta property="og:image:height" content="300"><meta name="twitter:image" content="${esc(posterUrl)}">` : ""}
${clipMediaUrl ? `<meta property="og:video" content="${esc(clipMediaUrl)}"><meta property="og:video:secure_url" content="${esc(clipMediaUrl)}"><meta property="og:video:type" content="${vtype}">` : ""}
<meta name="twitter:card" content="${posterUrl ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%8D%89%3C/text%3E%3C/svg%3E">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
</head><body style="background:#0a0a12;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:40px">
<script>location.replace(${JSON.stringify(appUrl)})</script>
<p>${esc(title)} — <a style="color:#29f4ff" href="${esc(appUrl)}">watch on AIRSLICE →</a></p>
</body></html>`);
});
