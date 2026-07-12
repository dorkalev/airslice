# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/dorkalev/airslice/security/advisories/new),
or email **dor@dorkalev.com**. Include steps to reproduce and the potential
impact. You can expect an initial response within a few days.

## Scope

AIRSLICE stores player-recorded webcam clips in Firebase Storage and serves a
public leaderboard. Reports that are especially valuable:

- Ways to read, overwrite, or delete another player's run, poster, or preview.
- Ways to bypass Firebase Storage security rules or App Check.
- Injection (XSS/HTML) in the `/c/<clip>` OpenGraph unfurl page.
- Ways to defeat the server-side upload rate limit at scale.

## Deploying safely (for forks)

- Keep all secrets (API keys, reCAPTCHA site key, webhook URLs) in your own
  `public/config.js` / Firebase Secret Manager — never commit them.
- Enable **Firebase App Check** enforcement on Storage.
- Set a **GCP budget alert** as a backstop against runaway egress/storage.
- Review `storage.rules` before going live; uploads publish camera footage
  publicly, so treat the consent flow and moderation page as security-relevant.
