# 🪔 ProductSquads Diwali Tambola

A real-time, multiplayer Tambola (Housie) web app for the ProductSquads Diwali celebration.

- **Host screen** (`/host`) – import the roster, generate tickets, draw numbers, confirm claims.
- **Projector / Teams screen** (`/display`) – the big screen with the animated gold coin, 1–90 board, prizes and winner fireworks.
- **Player screen** (`/play`) – each person's own tickets on their phone, where they tap to mark each called number, with "1 away" hints (based on what they've marked) and a Claim button.

Every number arrives as a spinning **Shubh Deepavali gold coin** that lands in the current-number circle, on every screen at the same time.

---

## What you need

- **Node.js 18 or newer.** Check with `node -v` in Terminal. If it's missing, install the "LTS" version from nodejs.org.
- That's it — no database or accounts. The game is saved to `data/game.json`.

## Run it on your laptop (5 minutes)

Open Terminal and run:

```bash
cd ~/workspace/diwali-tambola
npm install          # first time only
cp .env.example .env # first time only, then open .env and set HOST_PASSWORD
npm start
```

You'll see:

```
🪔  ProductSquads Diwali Tambola is running
   Players:   http://localhost:3000/play
   Projector: http://localhost:3000/display
   Host:      http://localhost:3000/host
```

- Open **/host** and log in with your `HOST_PASSWORD` (default `diwali2026` if you didn't set one).
- Open **/display** in another window (this is what you share on the projector / Teams) and click **Start the show** once so sound works.

**Testing with phones on office Wi-Fi:** find your laptop's IP address (System Settings → Wi-Fi → Details, e.g. `192.168.1.25`), set `PUBLIC_URL=http://192.168.1.25:3000` in `.env`, restart, and open that address on your phone. Remote players on Teams can't reach your laptop — for the real event, put it online (below).

## Run the tests

```bash
npm test
```

39 tests check ticket rules (3×9, 5 per row, right columns, ascending, all unique), ticket counts per player, top-ups, sales lock, CSV checks, and claim verification for every prize and every prize rule (bogeys, ties, one-prize-per-person, second Full House, undo).

## Put it online (free) – Render

Remote players need a public link. Render's free plan is the simplest:

1. Put this folder in a GitHub repository (GitHub Desktop → *Add existing repository* → *Publish*).
2. Go to **render.com**, sign in with GitHub, click **New → Blueprint**, and pick the repository. Render reads `render.yaml`.
3. When asked, set:
   - `HOST_PASSWORD` – your secret host password
   - `PUBLIC_URL` – leave empty for now
4. Click **Apply**. After a few minutes you get an address like `https://ps-diwali-tambola.onrender.com`.
5. Go back to the service → **Environment**, set `PUBLIC_URL` to that address, and save (it redeploys).

Important notes for the free plan:
- It **sleeps after 15 minutes without visitors** and takes ~1 minute to wake up. Open the host page 10 minutes before the game.
- Free services don't keep files after a redeploy or restart. Import the roster and send links **on the day**, and don't redeploy during the event. (A paid "Starter" instance with a small disk, mounted at `/opt/render/project/src/data`, removes this risk.)

Railway, Fly.io or any server/VM that runs Node also work: `npm install`, then `npm start` with the environment variables set.

## Caller voices (Indian, male + female)

The projector calls every number with its Diwali rhyme, e.g. *"62. Sixty-two, a laddoo for you"*, switching between a **male and a female Indian voice on alternate draws**. You can change this to male only or female only in **Setup & Prizes → Caller voice**.

The voices come from the browser on the projector laptop:
- **Best:** Microsoft Edge (Windows or Mac). It has natural-sounding Indian voices, Prabhat (male) and Neerja (female).
- **Mac + Chrome/Safari:** add **Rishi** (male) and **Veena** (female) under System Settings → Accessibility → Spoken Content → System voice → Manage voices → English (India).
- **Windows:** Ravi / Hemant (male) and Heera / Kalpana (female) come with Windows' Indian English and Hindi speech packs.

The projector's start screen shows which voices it found and has a **Test voices** button. If only one Indian voice exists, the app still alternates by changing the pitch.

**Recommended: run `npm run voices` once on a Mac.** It records all 90 calls (e.g. "62. Sixty-two, a laddoo for you") as audio files in the Mac's Indian English voice (Rishi), plus an English female voice for the alternate option, into `public/audio/calls/`. The projector then plays the file for each number — the same voice, but it can't go silent the way Chrome's live speech sometimes does on a Mac. Keep these files in the repository so they're there when the app is online. Without them, the app uses the browser's live voice.

## Environment variables

| Name | What it does |
|---|---|
| `HOST_PASSWORD` | Password for `/host`. **Change it.** |
| `PUBLIC_URL` | Public address used in personal links and QR codes, e.g. `https://ps-diwali-tambola.onrender.com`. Empty = use the address the host opened. |
| `PORT` | Port to listen on (hosting platforms set this). Default 3000. |
| `DATA_DIR` | Where `game.json` is saved. Default `./data`. |

## Folder structure

```
diwali-tambola/
├── server/
│   ├── index.js     Express pages + API, Socket.io real-time events, auto-draw
│   ├── game.js      Players, tickets, draws, claims, winners, rules, saving to disk
│   ├── tickets.js   Ticket generator + validator (Tambola rules)
│   ├── prizes.js    Prize patterns and verification against drawn numbers
│   ├── calls.js     90 Diwali number calls (edit freely)
│   ├── csv.js       Roster CSV reader / export writer
│   └── print.js     Printable tickets and player slips
├── public/
│   ├── host.html, display.html, play.html
│   ├── css/theme.css   Diwali theme, coin animation, toran, sparkles
│   ├── js/common.js    Coin animation, fireworks, sounds, voice, hints
│   ├── js/host.js, js/display.js, js/play.js
│   └── assets/logo.svg ProductSquads logo
├── tests/           node:test suites
├── sample-roster.csv
├── render.yaml      Render deploy blueprint
├── RUNBOOK.md       Step-by-step guide for the host on the day
└── .env.example
```

## How it stays fair

- Numbers are drawn on the server with a cryptographically secure random generator, each once.
- Tickets are generated on the server and checked against the rules; no two tickets are the same.
- Claims are verified on the server **only against numbers drawn so far** — what a player marked doesn't matter.
- The host confirms every claim. Ties (two players completing a prize on the same number) are detected automatically.
- Draws can't happen faster than the coin animation (3 seconds), so every screen sees every number.

## Assumptions made

- One game runs at a time (one company event). "Start a new round" keeps players and tickets; "Reset everything" wipes all.
- Players log in with a personal link (or Email/Employee ID + 4-digit PIN); there are no passwords to manage.
- Prizes and rule defaults: Early Five, three Lines, Four Corners, Full House and Second Full House on; Diya and Rangoli patterns available but off. Ties split by default. All changeable in **Setup & Prizes**.
- The **Diya** pattern is: the "flame" (3rd number of the top row) + the whole middle row + the "base" (2nd–4th numbers of the bottom row). **Rangoli** is the four corners + the centre (3rd number of the middle row).
