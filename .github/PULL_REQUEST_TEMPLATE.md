## Summary

<!-- A one-line description of what this PR does -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactor (no behaviour change)
- [ ] Performance improvement

## What Changed

<!-- Describe your changes in detail. Link to any relevant issues. -->

Fixes # (issue number, if applicable)

## How to Test

<!-- Step-by-step instructions to verify your change works correctly -->

1. Build the extension: `npm run build`
2. Load `/dist` as an unpacked extension in `chrome://extensions`
3. Navigate to `...`
4. Expected: `...`

## Checklist

- [ ] I have run `npm run test:run` and all tests pass
- [ ] I have run `npm run lint` and there are no lint errors
- [ ] I have run `npm run build` and the extension loads without errors
- [ ] All XP state changes go through `updateStats()` (not raw `saveStats()`)
- [ ] No DOM logic was added to `background.ts`
- [ ] No `src/lib/` imports were added to `content-script.ts`
- [ ] No external network calls were added outside of the HuggingFace model hub or localhost daemon
- [ ] I have updated relevant documentation (`ARCHITECTURE.md`, `GAMIFICATION.md`, etc.) if my change requires it
- [ ] I have updated `CHANGELOG.md` under `[Unreleased]`
