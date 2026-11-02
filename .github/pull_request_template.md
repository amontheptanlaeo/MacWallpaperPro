## What and why

<!-- What does this change, and why? Link the issue it fixes, e.g. "Fixes #123". -->

## How it was tested

<!-- Commands you ran, what you checked by hand. Add screenshots or a short video for UI changes. -->

## Checklist

- [ ] App changes: `swift build` passes and `python3 scripts/check-localization.py` is clean
- [ ] Website changes: `npm run check:i18n`, `npm run typecheck` and `npm test` pass in `web/`
- [ ] New user-facing strings are translated in all 17 languages (or I said which ones I couldn't do)
- [ ] Database changes are in a new, additive migration (`web/migrations/000N_*.sql`)
- [ ] Still compatible with installed app versions (`docs/ARCHITECTURE.md`)
- [ ] Docs and `CHANGELOG.md` (Unreleased) updated if behavior changed
- [ ] Comments and docs are in English; no secrets or personal data
- [ ] I agree that this contribution is released under GPL-3.0 and I have the right to submit it
