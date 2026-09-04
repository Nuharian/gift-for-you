# Gift For You

A student monitoring ecosystem in two parts:

1. **Student Desktop App** (Electron) — a Windows app that tracks study time, open apps and browser tabs, and receives messages from the teacher. It auto-starts with Windows and updates itself.
2. **Teacher Dashboard** (Next.js) — a real-time web dashboard showing every student's live study clock, what they have open, where their time went, and a two-way message thread.

Both talk directly to Firebase Firestore. There is no backend server to run.

---

## How the data flows

The student app writes on three cadences so the teacher sees a live clock without paying to rewrite big documents constantly:

| Every | Document | Contents |
|---|---|---|
| 10s | `gfy_students/{studentId}` | status, presence, **live study clock**, today's totals |
| 15s | `gfy_app_usage/{studentId}__live` | every open window, top apps, top tabs |
| 60s | `gfy_app_usage/{studentId}__{YYYY-MM-DD}` | absolute totals for the day |
| 2m | `gfy_activity/{auto}` | point-in-time history snapshots |
| on stop | `gfy_study_sessions/{id}` | a completed study session |
| on send | `gfy_messages/{id}` | teacher → student and student → teacher |

**Every read is either a document fetch by id or a single-equality-filter query.** Nothing pairs a filter with an `orderBy` on another field, so Firestore serves it all from automatic indexes — **no composite index needs to be created**, and sorting happens in memory.

---

## Quick Start

### Teacher Dashboard

```bash
cd teacher-dashboard
npm install
npm run dev          # http://localhost:3000
```

Log in with `ADMIN_PASSWORD` from `.env.local` (default `giftforyou2026`).

Deploy:

```bash
cd teacher-dashboard
npx vercel --prod
```

The Firebase config falls back to hardcoded values if the `NEXT_PUBLIC_FIREBASE_*` env vars are unset, so a deploy that forgets them still works. Set `ADMIN_PASSWORD` in the Vercel project settings.

### Student App — development

```bash
cd student-app
npm install
npm run dev
```

Auto-start and auto-update are both disabled in development builds.

### Student App — building an installer

```bash
cd student-app
npm run build        # -> dist/Gift-For-You-Setup-<version>.exe
```

This produces an NSIS installer (not a zipped folder). The installer is what makes auto-update possible — see below.

---

## Auto-update: how to ship a new version

Students never re-download the app by hand. The app checks GitHub Releases on launch and every six hours, downloads in the background, and installs on restart.

**To release an update:**

1. Bump `version` in `student-app/package.json` (e.g. `1.1.0` → `1.1.1`).
2. Export a GitHub token with `repo` scope:
   ```bash
   export GH_TOKEN=ghp_yourtokenhere
   ```
3. Build and publish:
   ```bash
   cd student-app
   npm run release
   ```
   This uploads the installer plus `latest.yml` to a GitHub release on `Nuharian/gift-for-you`.
4. Publish the release (if it was created as a draft).

Every running student app picks it up within six hours — or immediately if the student clicks **Check for updates** in Settings. `latest.yml` is the file electron-updater reads; without it, nothing updates, which is why the build target must stay `nsis` rather than `dir`.

To publish a draft first and release it manually, use `npm run draft`.

### About the build cache

electron-builder ships its signing tools for all platforms in one archive, and
extracting the macOS part on Windows needs elevated rights — without them the
build stops before the NSIS step, leaving no installer and no `latest.yml`.

`npm run build` handles this automatically: a `prebuild` hook populates the
cache with the macOS files skipped (we only ship Windows). It is a no-op once
the cache is good, and if it ever fails the build proceeds exactly as it would
have. Turning on Windows Developer Mode also fixes it permanently.

A successful build produces three files in `student-app/dist/`:

| File | Why it matters |
|---|---|
| `Gift-For-You-Setup-<version>.exe` | the installer students run once |
| `latest.yml` | **the update manifest** — without it nothing auto-updates |
| `*.blockmap` | lets updates download only changed bytes instead of the full 90 MB |

All three must be attached to the GitHub release. `npm run release` does that for you.

---

## Firestore rules

`firestore.rules` documents the five collections in use. **Deploying it is optional** — the live project already permits exactly these collections, and both apps stay inside them.

```bash
firebase deploy --only firestore:rules
```

The rules are open (anyone with the public API key can read and write). That matches how the project is already set up; add Firebase Auth before using this beyond a trusted group.

---

## Exporting data for analysis

The dashboard has an **Export data** panel that produces raw numbers with the
percentages already worked out — for a spreadsheet, or to hand to an AI.

| Button | Output |
|---|---|
| Copy Markdown | the full report on the clipboard, ready to paste into Claude |
| Download .md | the same report as a file |
| Daily summary CSV | one row per student per day: study, focused and screen time |
| App time CSV | one row per student per day per app, with % of focused time |
| Tabs & windows CSV | one row per window/tab title, with % of focused time |
| Study sessions CSV | one row per completed session |

Pick all students or just the selected one, over 7, 14 or 30 days.

Three terms appear throughout, and they mean different things:

- **study** — time on a session the student explicitly started.
- **focused** — time an app was the foreground window *and* the student was at the keyboard.
- **screen** — time an app was open at all. Always ≥ focused.

`focus_ratio` (focused ÷ open) shows whether an app was actually being used or
just left open. The Markdown report repeats these definitions at the top, so it
can be pasted into an AI on its own and still be interpreted correctly. Days
with no activity are included as zero rows so averages are not skewed.

---

## What the student app tracks

- **Study clock** — started by the student, derived from wall-clock timestamps so a throttled timer can't lose time. Persists across restarts and crashes; auto-pauses after 3 minutes of no keyboard/mouse input and resumes on the next input.
- **Per-app time** — how long each app was open, and how long it was actually focused.
- **Per-window/tab time** — the same, keyed by window title. Since a browser window's title is its active tab, this answers "which tab was open longest" and "which one were they actually working in".
- **Presence checks** — a random prompt every 15–30 minutes during a session; no answer within 2 minutes pauses the clock.

### Starting with Windows

The app registers itself under `HKCU\...\CurrentVersion\Run` and launches
hidden in the tray at every login. It re-registers on each start, so an update
that changes the install path cannot leave a dead entry behind, and it never
overrides a student who switched it off in Settings. Registration is skipped in
development builds so `npm run dev` does not add a login item pointing at
electron.exe.

Time is only credited while the student is actually at the keyboard, so a window left open overnight does not read as eight hours of work. Daily counters are persisted locally and written as absolute totals, so restarting the app never resets the teacher's view.
