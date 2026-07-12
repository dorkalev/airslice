# Contributing to AIRSLICE

Thanks for your interest! AIRSLICE is a small, dependency-light browser game:
on-device webcam hand tracking (LiteRT.js) turns your index finger into a blade
for slicing flying fruit. Contributions of all sizes are welcome.

## Ground rules

- Be kind and constructive — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Keep it simple. The whole game is vanilla JS with no build step; please don't
  introduce a framework or bundler without discussing it in an issue first.
- One focused change per pull request.

## Project layout

```
public/
  index.html        the game (canvas, hand tracking, gameplay, wall)
  admin.html        moderation page (owner-only)
  leaderboard.js    Firebase data layer (auth, storage, run encoding)
  config.js         deployment config — fill in with YOUR OWN Firebase values
functions/          Cloud Functions: upload notify, rate limit, /c/ unfurls
storage.rules       Firebase Storage security rules
firebase.json       hosting + rewrites + emulators
```

## Running it locally

1. Create your own Firebase project (Hosting + Storage + Anonymous Auth).
2. Copy your web-app config into `public/config.js` (see the placeholders there).
3. Serve `public/` over `http://localhost` (a webcam and ES modules both require
   a secure/localhost origin), e.g. `npx serve public` or `firebase emulators:start`.
4. Deploy with `firebase deploy` once you're happy.

> `public/config.js` holds deployment-specific values. Never commit real API
> keys, reCAPTCHA site keys, or webhook URLs — those belong in your own fork's
> config and in Firebase Secret Manager.

## Submitting changes

1. Fork the repo and create a branch: `git checkout -b my-change`.
2. Test in a real browser (camera flow included) before opening a PR.
3. Open a pull request using the template and describe what you changed and why.

## Reporting bugs & ideas

Use the issue templates. For anything security-sensitive, please follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
