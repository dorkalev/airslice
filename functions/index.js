// AIRSLICE Cloud Functions (server-side, cannot be bypassed by the client).
//  - Rate-limits uploads per uploader per day and deletes anything over the cap.
//  - Notifies a Slack/Discord webhook on each accepted run.
// The webhook URL is a secret:  firebase functions:secrets:set NOTIFY_WEBHOOK_URL

const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

const NOTIFY_WEBHOOK_URL = defineSecret("NOTIFY_WEBHOOK_URL");
const BUCKET = "YOUR_PROJECT.firebasestorage.app";
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

    // ---- server-side rate limit (per uploader per UTC day) ----
    if (owner) {
      const day = new Date(event.data.timeCreated || Date.now()).toISOString().slice(0, 10);
      const counter = bucket().file(`counters/${owner}_${day}`);
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
        logger.warn(`rate limit: ${owner} over ${DAILY_CAP}/day — deleted ${path}`);
        return;
      }
    }

    // ---- notify ----
    const m = leaf.match(/^(\d{7})_(\d{13})_(\d+)f_x(\d+)\./);
    const score = m ? 9999999 - parseInt(m[1], 10) : "?";
    const sliced = m ? m[3] : "?";
    const combo = m ? m[4] : "?";
    const sizeMB = event.data.size ? (Number(event.data.size) / 1048576).toFixed(1) : "?";
    const msg = `🍉 New AIRSLICE run posted: ${score} pts (${sliced} sliced, combo x${combo}) · ${sizeMB} MB`;

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
