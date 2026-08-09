// The key.
//
// A global hotkey on macOS through Carbon's RegisterEventHotKey — which, unlike
// a CGEventTap, needs no Accessibility permission and cannot see any keystroke
// but the one it asked for. That distinction is the reason it is worth ~120
// lines of Swift instead of a keyboard-macro app: this program is incapable of
// reading what you type.
//
// It runs as an accessory: no Dock icon, no menu bar, no window. It sits there
// waiting for ⌘⇧E and then runs one command.
//
//   swiftc -O hotkey/Freejarvis.swift -o ~/.freejarvis/freejarvis-hotkey
//   ~/.freejarvis/freejarvis-hotkey /path/to/bin/freejarvis.mjs

import AppKit
import Carbon.HIToolbox

let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/freejarvis/data/reels")
let logURL = home.appendingPathComponent("hotkey.log")

func log(_ line: String) {
    try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    let stamped = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
    if let handle = try? FileHandle(forWritingTo: logURL) {
        handle.seekToEndOfFile()
        handle.write(stamped.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? stamped.write(to: logURL, atomically: true, encoding: .utf8)
    }
}

func notify(_ title: String, _ body: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    let esc = { (s: String) in s.replacingOccurrences(of: "\"", with: "\\\"") }
    p.arguments = ["-e", "display notification \"\(esc(body))\" with title \"\(esc(title))\""]
    try? p.run()
}

/// The command to run, and the guard against running it twice at once.
///
/// A hotkey is easy to hit twice. Two runs at once would fight over the same
/// browser tab and the same clip, so the second press is ignored while the
/// first is still going — and says so, rather than silently doing nothing.
final class Runner {
    private let script: String
    private let node: String
    private var busy = false
    private let queue = DispatchQueue(label: "freejarvis.runner")

    init(script: String, node: String) {
        self.script = script
        self.node = node
    }

    func fire() {
        queue.async {
            if self.busy {
                log("ignored — a run is already going")
                notify("freejarvis", "Already running.")
                return
            }
            self.busy = true
            notify("freejarvis", "Taking the next clip…")
            log("fired: \(self.node) \(self.script)")

            let p = Process()
            p.executableURL = URL(fileURLWithPath: self.node)
            p.arguments = [self.script]
            // The hotkey has no terminal, so everything goes to the log.
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            if let handle = try? FileHandle(forWritingTo: logURL) {
                handle.seekToEndOfFile()
                p.standardOutput = handle
                p.standardError = handle
            }
            p.terminationHandler = { proc in
                log("finished with status \(proc.terminationStatus)")
                if proc.terminationStatus != 0 {
                    notify("freejarvis — stopped", "Exit \(proc.terminationStatus). See ~/.freejarvis/hotkey.log")
                }
                self.queue.async { self.busy = false }
            }
            do {
                try p.run()
            } catch {
                log("could not start: \(error)")
                notify("freejarvis — stopped", "Could not start: \(error.localizedDescription)")
                self.busy = false
            }
        }
    }
}

// ── wiring ──────────────────────────────────────────────────────────────────

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: reels-hotkey /path/to/scripts/reels-go.mjs [node]\n".data(using: .utf8)!)
    exit(2)
}
let runner = Runner(script: args[1], node: args.count > 2 ? args[2] : "/usr/bin/env")

// Carbon hands the callback a raw pointer, so the runner is reached through a
// file-scope reference rather than a capture — a C callback cannot close over
// Swift state.
var hotKeyRef: EventHotKeyRef?
var hotKeyID = EventHotKeyID(signature: OSType(0x48_41_4E_47), id: 1) // 'HANG'

let handler: EventHandlerUPP = { _, event, _ -> OSStatus in
    var id = EventHotKeyID()
    GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                      nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
    if id.id == 1 { runner.fire() }
    return noErr
}

var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
InstallEventHandler(GetApplicationEventTarget(), handler, 1, &spec, nil, nil)

let status = RegisterEventHotKey(
    UInt32(kVK_ANSI_E),
    UInt32(cmdKey | shiftKey),
    hotKeyID,
    GetApplicationEventTarget(),
    0,
    &hotKeyRef
)

if status != noErr {
    // Almost always means something else already owns ⌘⇧E.
    log("could not register ⌘⇧E (OSStatus \(status)) — another app probably has it")
    notify("freejarvis", "Could not register ⌘⇧E. Another app may have it.")
    exit(1)
}

log("listening for ⌘⇧E → \(args[1])")
let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, no menu bar
app.run()
