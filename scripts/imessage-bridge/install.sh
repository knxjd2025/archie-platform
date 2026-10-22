#!/usr/bin/env bash
# Install the iMessage bridge as a launchd agent so it runs whenever you are logged in.
#   BRN_BRIDGE_TOKEN=brn_im_... scripts/imessage-bridge/install.sh [--all]
set -euo pipefail
: "${BRN_BRIDGE_TOKEN:?Set BRN_BRIDGE_TOKEN (My Account → iMessage bridge)}"
APP_URL="${BRN_APP_URL:-https://app.bestroofingnow.com}"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
LABEL="com.bestroofingnow.imessage-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/brn-imessage-bridge.log"
EXTRA=""; [[ "${1:-}" == "--all" ]] && EXTRA="<string>--all</string>"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/bridge.mjs</string>$EXTRA</array>
  <key>EnvironmentVariables</key><dict>
    <key>BRN_APP_URL</key><string>$APP_URL</string>
    <key>BRN_BRIDGE_TOKEN</key><string>$BRN_BRIDGE_TOKEN</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Log: $LOG"
echo "Give Full Disk Access to: $NODE  (System Settings → Privacy & Security → Full Disk Access)"
echo "Remove with: launchctl unload $PLIST && rm $PLIST"
