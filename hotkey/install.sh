#!/usr/bin/env bash
# Gives ⌘⇧E to freejarvis, and makes sure nothing else has it.
#
#   ./hotkey/install.sh          install and start
#   ./hotkey/install.sh remove   stop and remove
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/data/reels"
BIN="$STATE/reels-hotkey"
PLIST="$HOME/Library/LaunchAgents/dev.freejarvis.reels.plist"
LABEL="dev.freejarvis.reels"

if [ "${1:-}" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$BIN"
  echo "removed."
  exit 0
fi

# One key, one owner. A second agent bound to ⌘⇧E does not error — it simply
# never fires, because Carbon gives the chord to whoever registered it first,
# and which one that is depends on login order. That is the worst kind of bug:
# it works on the machine you tested it on.
for other in dev.hangar.hotkey; do
  if launchctl print "gui/$(id -u)/$other" >/dev/null 2>&1; then
    echo "taking ⌘⇧E off $other"
    launchctl bootout "gui/$(id -u)/$other" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$other.plist"
  fi
done

mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
echo "compiling…"
swiftc -O "$ROOT/hotkey/Reels.swift" -o "$BIN"

NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "node is not on PATH" >&2; exit 1; }

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>$ROOT/scripts/reels-go.mjs</string>
    <string>$NODE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$STATE/hotkey.out.log</string>
  <key>StandardErrorPath</key><string>$STATE/hotkey.err.log</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 1

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "⌘⇧E is freejarvis's now. Press it anywhere."
  echo "log: $STATE/hotkey.log"
else
  echo "the agent did not stay up — see $STATE/hotkey.err.log" >&2
  exit 1
fi
