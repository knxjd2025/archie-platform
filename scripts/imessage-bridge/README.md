# iMessage bridge

Apple has no iMessage API, so this runs on the Mac that is signed into Messages.
It reads new rows from `~/Library/Messages/chat.db` (read-only, through the
`sqlite3` CLI), keeps the 1:1 threads with people the app knows (clients and
leads by phone or email), and posts them to the Team App under the account the
bridge token belongs to. Replies typed in the app are queued and the bridge
sends them through Messages.app with AppleScript.

1. Team App → My Account → **iMessage on my Mac** → *Set up the bridge* → copy the command.
2. System Settings → Privacy & Security → **Full Disk Access** → enable Terminal
   (or `node` if you install it at login).
3. Run the command from the app's folder. It logs what it syncs. `--all` syncs
   every thread instead of only client threads; group chats are never synced.
4. `BRN_BRIDGE_TOKEN=... scripts/imessage-bridge/install.sh` installs it as a
   launchd agent that starts at login (`--all` optional). Logs land in
   `~/Library/Logs/brn-imessage-bridge.log`.

State (the last row read) lives in `~/.brn-imessage-bridge.json`; delete it to
resync the last 30 days (`BRN_BACKFILL_DAYS` changes that window).
