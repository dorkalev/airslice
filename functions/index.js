// AIRSLICE — notify a Slack/Discord webhook whenever a run is posted.
// The webhook URL is a secret: set it with
//   firebase functions:secrets:set NOTIFY_WEBHOOK_URL
// (paste your Slack "Incoming Webhook" or Discord channel webhook URL).

const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");

const NOTIFY_WEBHOOK_URL = defineSecret("NOTIFY_WEBHOOK_URL");
const BUCKET = "YOUR_PROJECT.firebasestorage.app";
// NOTE: the function region MUST match your bucket's region (check it in the
// Firebase console → Storage). A mismatch fails with "cannot listen to a bucket
// in region ...".
const REGION = "us-central1";

exports.notifyOnUpload = onObjectFinalized(
  { bucket: BUCKET, secrets: [NOTIFY_WEBHOOK_URL], region: REGION, memory: "128MiB" },
  async (event) => {
    const path = event.data.name || "";
    if (!path.startsWith("runs/")) return;

    // runs/<invScore7>_<ts13>_<sliced>f_x<combo>.<ext>
    const m = path.slice(5).match(/^(\d{7})_(\d{13})_(\d+)f_x(\d+)\./);
    const score = m ? 9999999 - parseInt(m[1], 10) : "?";
    const sliced = m ? m[3] : "?";
    const combo = m ? m[4] : "?";
    const sizeMB = event.data.size ? (Number(event.data.size) / 1048576).toFixed(1) : "?";
    const msg = `🍉 New AIRSLICE run posted: ${score} pts (${sliced} sliced, combo x${combo}) · ${sizeMB} MB`;

    const url = NOTIFY_WEBHOOK_URL.value();
    if (!url) { logger.warn("NOTIFY_WEBHOOK_URL is empty"); return; }

    // Discord expects { content }; Slack expects { text }
    const isDiscord = url.includes("discord.com") || url.includes("discordapp.com");
    const body = isDiscord ? { content: msg } : { text: msg };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) logger.error("webhook non-2xx", res.status, await res.text());
    } catch (e) {
      logger.error("webhook error", e);
    }
  }
);
