# Revision Pulse 💓

A small, friendly iPhone app (a Home Screen web app) for tracking finals revision:
question-bank questions every day plus OSCE station practice, with a progress line that
shows whether you're on target for finals starting **Monday 25 January 2027**.

## What it does

- **Today**: tap +10 / +25 / +50 as you do questions (or tap the big number to type it). Tick the
  OSCE stations you practised. Confetti when the day's target is hit.
- **Race the tortoise** 🐢: the tortoise walks the plan. Stay level or ahead and you'll finish on time.
- **Journey**: "vitals check" (ahead / on target / how to catch up), the progress line vs. the
  plan line, a streak, and a calendar. Tap any day to fix it or plan a rest day.
- **OSCE**: 38 common stations in groups. Tap to tick for today; each station earns a 🏅
  once practised 3 times. Add or remove stations with **Edit**.
- **Suggested next** (on Today): three one-tap OSCE suggestions using spaced practice. A station
  comes back for a refresh 2 days after its first practice, then 4, then 7, then every 10 days. Each day
  suggests the station most overdue for a refresh (if any), then stations never tried, picked from different
  groups where possible. Stations due a refresh show **🔁 due** on the OSCE screen.
- **Demo**: Settings → *Try with sample data* (or add `?demo` to the link) opens four weeks of made-up
  progress, kept separate from real data.
- **Settings**: dates and daily targets, plus backup and restore.

Default plan (all editable on first launch or in Settings):

| Period | Dates | Questions/day | OSCE stations/day |
|---|---|---|---|
| Placement | until Sun 13 Dec | 50 | 1 |
| Revision break | 14 Dec – 24 Jan | 125 | 3 |

Rest days set a target of zero for that day, so planning a day off (e.g. Christmas Day) doesn't count as falling behind.
Being under today's target never shows as "behind" until the day is over.

## Putting it on an iPhone

The app has to be served over HTTPS once. After that it works offline.

1. Host this folder anywhere static, e.g. **GitHub Pages** or **Netlify Drop**
   (drag the `RevisionPulse` folder onto app.netlify.com/drop).
2. On the iPhone, open the link in **Safari** → **Share** → **Add to Home Screen** → **Add**.
3. Open it from the Home Screen icon. It runs full-screen like a normal app.

Data stays on the phone only (no accounts, nothing is sent anywhere). Use **Settings → Save a backup**
now and then. On iPhone this opens the share sheet, so the student can save the backup to Files or email it to themselves.

## Running it locally

```bash
python3 -m http.server 5181 --directory RevisionPulse
```

Then open http://localhost:5181. Add `?today=2026-12-20` to the URL to preview the app as if it were
another date. Offline caching is off on localhost unless you add `?sw=1`.

## Updating

Edit the files and upload them again. Phones pick up the new version the next time the app is opened online.
If you change files, also bump `VERSION` in `sw.js` so old caches are cleared.
