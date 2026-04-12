# Gamification System

The AI Hygiene Companion rewards safe, security-conscious browsing behaviour through an XP and badge system. This document is the complete reference for how the gamification engine works.

---

## Design Philosophy

Pure blocklists and passive warnings are ineffective at changing user behaviour long-term. The gamification loop creates **intrinsic motivation** by:

1. Making safe behaviour immediately visible (+XP toast on every new safe page)
2. Creating a visible sense of progression (levels, titles, badges)
3. Applying real consequences for risky behaviour (XP penalties)
4. Rewarding recovery from mistakes (Panic Button flow)

---

## XP (Experience Points)

XP is a cumulative integer stored in `chrome.storage.local`. It never decays below zero.

### XP Events

| Event | XP Change | Trigger |
|---|---|---|
| **Safe page visit** | +5 | Every unique URL navigated to that scores `safe` or `warning` |
| **Secure login detected** | +10 | Password field on an HTTPS page |
| **Danger avoided** | +25 | Navigating away from a page *after* it was flagged as `danger` |
| **Panic button initiated** | +5 | Clicking the Panic Button |
| **Recovery completed** | +30 | Finishing all steps in the panic recovery flow |
| **Badge earned bonus** | +50 | Any badge earned for the first time |
| **Streak milestone** | +15 | Reaching a streak milestone (10, 25, 50 pages) |
| **Dangerous site loaded** | **−15** | Navigating to a page that scores `danger` |
| **Unsecured password field** | **−0** | Password on HTTP (badge only, no XP penalty — educational) |

### XP Deduplication

To prevent refresh-farming, XP is awarded **once per unique URL per browser session**. Each YouTube Short has a unique URL, so scrolling through Shorts naturally awards XP for each new video. Refreshing the same URL does not re-award XP until the browser session ends.

### Rate Limiting for Toasts

XP accrual is never blocked, but the **notification toast** (the popup that appears bottom-right) is rate-limited to once every 3 seconds to prevent visual clutter during rapid navigation (e.g., opening many tabs).

---

## Levels

There are 10 levels with increasing XP thresholds. Level title is displayed in the popup dashboard header.

| Level | XP Required | Title |
|---|---|---|
| 1 | 0 | Newcomer |
| 2 | 100 | Browser |
| 3 | 200 | Surfer |
| 4 | 300 | Defender |
| 5 | 400 | Guardian |
| 6 | 500 | Sentinel |
| 7 | 600 | Shield Master |
| 8 | 700 | Security Expert |
| 9 | 800 | Cyber Guardian |
| 10 | 900 | Digital Hygiene Hero |

The XP bar in the popup shows progress within the current level (not total XP), so it always resets to 0 on level-up and fills toward the next 100.

---

## Badges

There are 12 badges organised into 4 categories with 3 tiers each (Bronze → Silver → Gold).

### Streak Category

| Badge | Tier | Requirement |
|---|---|---|
| Streak Starter | 🥉 Bronze | Browse 10 pages safely in a row |
| Streak Veteran | 🥈 Silver | Browse 25 pages safely in a row |
| Streak Legend | 🥇 Gold | Browse 50 pages safely in a row |

> A streak resets to 0 whenever a `danger`-rated page is loaded.

### Threat Category

| Badge | Tier | Requirement |
|---|---|---|
| Phish Spotter | 🥉 Bronze | Avoid your first phishing site |
| Danger Survivor | 🥈 Silver | Navigate away from 3 dangerous sites |
| Threat Hunter | 🥇 Gold | Avoid 10 phishing or dangerous sites total |

### Recovery Category

| Badge | Tier | Requirement |
|---|---|---|
| Safe Surfer | 🥉 Bronze | Complete your first safe browsing session |
| Recovery Hero | 🥈 Silver | Use the Panic Button and complete all recovery steps |
| Bounce Back | 🥇 Gold | Complete the recovery flow 3 times |

### Habit Category

| Badge | Tier | Requirement |
|---|---|---|
| Password Pro | 🥉 Bronze | Encounter a password field on an HTTP (unsecured) page |
| Secure Login | 🥈 Silver | Successfully log in on an HTTPS site |
| Hygiene Master | 🥇 Gold | Reach Level 5 |

---

## Safe Browsing Streak

The streak counter (`safeBrowsingStreak`) increments by 1 each time XP is awarded for a safe page visit. It resets to 0 when a `danger`-rated page triggers the `applyDangerPenalty` function.

Streak badges (Streak Starter, Veteran, Legend) are awarded at milestones 10, 25, and 50. Each milestone also awards an additional +15 XP streak bonus on top of the +50 badge bonus.

---

## Panic Button & Recovery

When the user encounters a danger site, the Panic Button is displayed prominently in the popup.

1. **Clicking Panic** calls `onPanicButtonClicked()` (+5 XP, marks `panicButtonUsed: true`)
2. The recovery flow displays step-by-step guidance: change passwords, enable 2FA, check logins, run a malware scan
3. **Completing recovery** calls `onRecoveryCompleted()` (+30 XP, awards Recovery Hero badge if first time, Bounce Back badge at 3rd time)

---

## Implementation Reference

| Function | File | Purpose |
|---|---|---|
| `awardSafeBrowsingXp` | `src/lib/gamification.ts` | +5 XP + streak counter + streak badges |
| `awardDangerAvoidedXp` | `src/lib/gamification.ts` | +25 XP + threat badges |
| `applyDangerPenalty` | `src/lib/gamification.ts` | −15 XP + streak reset |
| `onSecureLoginAttempt` | `src/lib/gamification.ts` | +10 XP + Secure Login badge |
| `onPasswordFieldHttp` | `src/lib/gamification.ts` | +0 XP + Password Pro badge |
| `onPanicButtonClicked` | `src/lib/gamification.ts` | +5 XP |
| `onRecoveryCompleted` | `src/lib/gamification.ts` | +30 XP + recovery badges |
| `updateStats` | `src/lib/storage.ts` | Mutex-protected write — all XP changes go through this |
| `hasXpBeenAwardedForUrl` | `src/background.ts` | Per-URL XP dedup using `chrome.storage.session` |
| `canShowToast` | `src/background.ts` | 3-second toast cooldown |
