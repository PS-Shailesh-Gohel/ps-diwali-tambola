# Host runbook – Diwali Tambola

## The week before
1. **Collect purchases** in a sheet with these columns: `Name`, `Email/Employee ID`, `Team`, `Tickets Bought`, `Paid (Yes/No)`. (Host screen → Players & Tickets → *Download template* gives you an example.)
2. **Do a dry run** with 5–10 colleagues on their phones, including one on an iPhone and one remote on Teams.

## Setup (morning of the game)
1. Open `/host`, log in.
2. **Setup & Prizes:** set the title, ticket price, max tickets, prize values (e.g. "₹1,000 voucher"), which prizes are in play, and the tie rule. Click **Save settings**.
3. **Players & Tickets → Upload CSV.** Fix any rows it flags (duplicate IDs, missing names, tickets above max, Paid not Yes/No) in your sheet and upload again. When it's clean, click **Import**. Paid players get their tickets straight away.
   - Someone marked Unpaid gets no tickets until you click **Edit** and tick **Paid**.
   - Re-uploading the sheet later updates people (matched by Email/Employee ID).
4. **Export send-ready CSV.** It has each person's personal link and PIN. Use it for a mail merge (Outlook / Word) or paste links into Teams chats.
   Suggested message:
   > 🪔 Your Diwali Tambola tickets are ready! Open your personal link on your phone: **[link]**. Keep it private — it's your tickets. If the link doesn't open, go to **[site]/play** and log in with your email/Employee ID and PIN **[PIN]**.
5. Ask everyone to **open their link before the game** so problems show up early.
6. Optional: **Print slips** (QR + PIN per person) or **Print all tickets** for people who prefer paper.

## Just before the game
1. On the projector laptop open `/display`, click **Start the show** (enables sound), then **Full screen** (bottom right). Share this window on Teams with "Include computer sound" on.
2. Keep `/host` on your own laptop or phone, on the **Game Control** tab.
3. Walk-ins: **Players & Tickets → Add player / walk-in**. Enter name, ID and tickets, click **Save & generate tickets**, and let them scan the QR that appears. To add tickets to someone who already has some, use the same Email/ID or the **Edit / + Tickets** button.

## Running the game
- **Draw next number** (or press **Spacebar**). The gold coin flies on every screen; the button unlocks again after it lands.
- **Auto-draw** draws every N seconds (set in Setup). Click **Stop auto** to pause, e.g. while checking a claim.
- **Undo last** takes back the last number (not allowed once a prize was confirmed on it).
- **Mute voice** turns the projector's spoken calls on/off.
- Ticket sales lock automatically at the first draw. **Override lock** on the Players tab lets you add a late walk-in anyway.

## Handling claims
Claims appear instantly in **Live claims**, already checked by the app against the numbers drawn so far:

| What you see | What to do |
|---|---|
| ✓ **Valid** | **Confirm & announce** → winner banner + fireworks on the projector and the winner's phone. |
| ✕ **Not valid** (shows the missing numbers) | **Mark Bogey** → "Bogey!" on the projector; that player can't claim that prize again. Or **Dismiss** if it was an honest mis-tap and you want to be kind. |
| **Tie** (two people completed it on the same number) | **Confirm tie** → both are winners; the prize is split or both win in full, per your Setup rule. A tie claimed slightly after the first confirmation is still accepted. |

Other rules the app enforces for you: a person can win different prizes on different tickets, but never the same prize twice; the Second Full House opens only after the first is won, and must be on a different ticket; optional "one prize per person".

## After the game
- **Winners → Export results CSV** (prize, winner, team, ticket ID, winning number, and the full draw order) for prize distribution.
- **End game** stops further draws. **Start a new round** clears numbers and winners but keeps everyone's tickets, for a second game.

## If something goes wrong
- **A player's link "isn't valid"**: check their row on Players & Tickets — they may be Unpaid. Use **Link & QR** to show or copy their link again.
- **Projector has no sound**: click **Sound on** (bottom right) — browsers need one click before playing audio.
- **Someone's phone is open on 3+ devices**: the Players tab shows a warning. Their tickets are personal — check they haven't shared the link.
- **Server restarted**: everything (players, tickets, draws, claims) is saved; people just refresh.
