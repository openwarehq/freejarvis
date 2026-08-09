"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActivityTicker from "@/components/ActivityTicker";
import ApprovalCard from "@/components/ApprovalCard";
import BootSequence from "@/components/BootSequence";
import DemoBar from "@/components/DemoBar";
import DemoHint from "@/components/DemoHint";
import Caption from "@/components/Caption";
import ChatDock from "@/components/ChatDock";
import Icon from "@/components/Icon";
import Orb from "@/components/Orb";
import Rail, { type PanelId } from "@/components/Rail";
import SiteView from "@/components/SiteView";
import ReelView from "@/components/ReelView";
import Telemetry from "@/components/Telemetry";
import TopBar from "@/components/TopBar";
import ApprovalsPanel from "@/components/panels/ApprovalsPanel";
import CronPanel from "@/components/panels/CronPanel";
import MemoryPanel from "@/components/panels/MemoryPanel";
import SessionsPanel from "@/components/panels/SessionsPanel";
import SettingsPanel from "@/components/panels/SettingsPanel";
import SkillsPanel from "@/components/panels/SkillsPanel";
import SoulPanel from "@/components/panels/SoulPanel";
import ToolsPanel from "@/components/panels/ToolsPanel";
import { SCRIPTS, scriptById } from "@/lib/demo";
import { useDeck } from "@/hooks/useDeck";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoice } from "@/hooks/useVoice";
import type { DeckState } from "@/lib/events";

/**
 * Which panel a tool belongs to.
 *
 * When the agent reaches for something, the deck opens the place that thing
 * lives — you watch the memory appear in Memory, the job appear in Cron. It
 * is the interface following the work rather than waiting to be told about it.
 */
const TOOL_PANEL: Record<string, PanelId> = {
  remember: "memory",
  recall: "memory",
  schedule: "cron",
  write_file: "tools",
  read_file: "tools",
  list_files: "tools",
  read_web: "tools",
  shell: "tools",
};

export default function Deck() {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [site, setSite] = useState<string | null>(null);
  // The reel browser, mirrored onto the deck while post_reel runs.
  const [reel, setReel] = useState(false);
  // A site opens windowed in the corner so the orb stays on screen next to
  // it; expanding is a deliberate click.
  const [siteFull, setSiteFull] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [booting, setBooting] = useState(true);

  // Demo mode is opt-in through the URL and nothing reaches it by accident.
  // See src/lib/demo.ts for what it is and what it is not.
  const [demo, setDemo] = useState<string | null>(null);
  // Demo mode records clean: no controls, no chat dock, no ticker. Everything
  // an operator needs is on a chord, so nothing has to be cropped out.
  const [controls, setControls] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("demo") === "1") setDemo(scriptById(q.get("script")).id);
  }, []);

  const speech = useSpeech(voiceOut);

  // The hooks need each other — the deck speaks through `speech`, `voice`
  // sends through the deck — so one side goes through a ref.
  const sendRef = useRef<(t: string) => void>(() => {});
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const demoRef = useRef<string | null>(demo);
  demoRef.current = demo;
  // In demo mode the whole script arrives at once, so the stream's tool
  // events land seconds before the voice reaches them. The orb follows the
  // queued action instead, which fires between two real audio clips.
  const [demoTool, setDemoTool] = useState(false);

  const deck = useDeck({
    onSentence: useCallback((sentence: string) => speech.enqueue(sentence), [speech]),
    endpoint: demo ? "/api/demo" : undefined,
    extra: demo ? { script: demo } : undefined,
    onTool: useCallback((name: string, args: string) => {
      // The mirrored browser panel is built and works — /api/reel streams it and
      // <ReelView> renders it — but it does not open itself. It was asked for
      // and then unasked for, and an extra window appearing bottom-right in the
      // middle of a take is the sort of thing you only notice in the edit.
      // Press ⌘⇧M to bring it up.
      if (name === "post_reel") return;
      if (name === "open_site") {
        let site: string | null = null;
        try {
          const parsed = JSON.parse(args || "{}") as { name?: string };
          if (parsed.name) site = String(parsed.name).replace(/\.html$/i, "");
        } catch {
          /* the tool will report the failure itself */
        }
        if (!site) return;
        const open = () => {
          setPanel(null);
          setSiteFull(false);
          setSite(site);
        };
        // Live, a tool is a real action and happens now. Scripted, it waits
        // its turn in the speech queue so it lands on the line that announces
        // it rather than ten seconds before.
        if (demoRef.current) {
          speechRef.current.enqueueAction(() => {
            setDemoTool(true);
            open();
            setTimeout(() => setDemoTool(false), 700);
          });
        } else {
          open();
        }
        return;
      }
      const target = TOOL_PANEL[name];
      if (target && !demoRef.current) setPanel(target);
    }, []),
  });

  const voice = useVoice({
    onFinal: (text) => sendRef.current(text),
    onInterim: () => {},
  });
  sendRef.current = (t) => void deck.send(t);

  const state: DeckState = deck.approval
    ? "awaiting-approval"
    : (demo ? demoTool : deck.toolState === "tool")
      ? "tool"
      : speech.speaking
        ? "speaking"
        : deck.running
          ? "thinking"
          : voice.listening
            ? "listening"
            : "idle";

  useEffect(() => {
    document.documentElement.dataset.state = state;
  }, [state]);

  /* Hold space to talk. Ignored while typing or while a card is up. */
  const held = useRef(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target) || deck.approval || booting) return;
      e.preventDefault();
      held.current = true;
      // Talking into an open microphone while it is answering feeds it its
      // own voice, so the reply stops the moment you start.
      speech.cancel();
      voice.startListening();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      voice.stopListening();
    };
    const reset = () => {
      setSite(null);
      setSiteFull(false);
      setPanel(null);
      speech.cancel();
      deck.stop();
      deck.newSession();
    };

    // ⌘⌥⇧A / ⌘⌥⇧R / ⌘⌥⇧D — chords rather than bare keys, because during a
    // take the deck is listening to the room and a stray keypress is a ruined
    // shot. `e.code`, not `e.key`: with Option held on macOS the character is
    // not the letter — A becomes "å", R becomes "®", D becomes "∂".
    const takeKeys = (e: KeyboardEvent) => {
      // ⌘⇧E — send the next reel, without saying anything.
      //
      // Deliberately outside the demo-only guard and off the ⌘⌥⇧ chord the
      // filming keys use. Everything else on this deck is something you talk
      // to; this is the one thing you want done while your hands are somewhere
      // else, so it is one key and it works whether or not a take is loaded.
      // ⌘⇧M — mirror the reel browser onto the deck, for when you want to see
      // what it is doing without going to find the window.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyM") {
        e.preventDefault();
        setReel((v) => !v);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyE") {
        e.preventDefault();
        reset();
        setDemo("reel");
        setTimeout(() => sendRef.current(scriptById("reel").prompt), 120);
        return;
      }

      if (!demo) return;
      const chord = (e.metaKey || e.ctrlKey) && e.altKey && e.shiftKey;
      if (!chord) return;
      if (e.code === "KeyA") {
        e.preventDefault();
        reset();
        // Let the reset paint before the take starts, or the first caption
        // lands on the tail of the previous one.
        setTimeout(() => sendRef.current(scriptById(demo).prompt), 120);
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        reset();
      }
      if (e.code === "KeyD") {
        e.preventDefault();
        setControls((v) => !v);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || deck.approval) return;
      if (speech.speaking) speech.cancel();
      else if (deck.running) deck.stop();
      else if (site) setSite(null);
      else setPanel(null);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("keydown", esc);
    window.addEventListener("keydown", takeKeys);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("keydown", takeKeys);
    };
  }, [deck, voice, speech, site, booting, demo]);

  const satellites = useMemo(
    () =>
      deck.sessions
        .filter((s) => s.id !== deck.sessionId)
        .slice(0, 6)
        .map((s) => ({ hue: hashHue(s.id) })),
    [deck.sessions, deck.sessionId],
  );

  const level = speech.speaking ? speech.level : voice.level;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <Orb
        state={state}
        level={level}
        satellites={satellites}
        offsetX={site && !siteFull ? -150 : panel ? 210 : 0}
        scale={siteFull ? 0.42 : 1}
      />

      <TopBar state={state} brain={deck.brain} onOpenSettings={() => setPanel("settings")} />

      <div className="relative flex min-h-0 flex-1">
        <Rail active={panel} onSelect={setPanel} pendingApprovals={deck.approval ? 1 : 0} />

        {panel === "sessions" && (
          <SessionsPanel
            onClose={() => setPanel(null)}
            currentId={deck.sessionId}
            onOpen={deck.openSession}
            onNew={deck.newSession}
          />
        )}
        {panel === "memory" && <MemoryPanel onClose={() => setPanel(null)} />}
        {panel === "cron" && <CronPanel onClose={() => setPanel(null)} />}
        {panel === "tools" && <ToolsPanel onClose={() => setPanel(null)} />}
        {panel === "skills" && <SkillsPanel onClose={() => setPanel(null)} />}
        {panel === "approvals" && <ApprovalsPanel onClose={() => setPanel(null)} />}
        {panel === "soul" && <SoulPanel onClose={() => setPanel(null)} />}
        {panel === "settings" && (
          <SettingsPanel
            onClose={() => setPanel(null)}
            brain={deck.brain}
            onPreviewVoice={speech.preview}
            onOpenSite={(name) => {
              setPanel(null);
              setSite(name);
            }}
            onChanged={deck.refreshBrain}
          />
        )}

        <main className="pointer-events-none relative min-w-0 flex-1">
          <Telemetry
            data={deck.telemetry}
            brain={deck.brain}
            engine={speech.engine}
            sessions={deck.sessions.length}
          />

          {site && (
            <SiteView
              name={site}
              full={siteFull}
              onToggleFull={() => setSiteFull((v) => !v)}
              onClose={() => setSite(null)}
            />
          )}

          {/* Windowed in the corner, like a site — the orb stays on screen
              beside it, which is the whole reason the browser is mirrored here
              instead of being brought to the front. */}
          {reel && (
            <div className="pointer-events-none absolute right-6 bottom-6 z-30 w-[min(46vw,620px)]">
              <ReelView onClose={() => setReel(false)} />
            </div>
          )}

          {/* Follow the voice when there is one — the text stream finishes
              long before the speaker does, so a stream-driven caption runs
              ahead of what you can actually hear. */}
          <Caption
            text={voiceOut && speech.current ? speech.current : deck.caption}
            interim={voice.interim}
          />

          {deck.failure && (
            <div className="pointer-events-auto absolute left-1/2 top-16 z-40 w-[min(520px,calc(100vw-120px))] -translate-x-1/2">
              <div
                className="rise glass rounded-[4px] p-3"
                style={{ borderColor: "hsl(8 92% 60% / 0.45)" }}
              >
                <div className="flex items-start gap-2">
                  <span className="label mt-0.5" style={{ color: "hsl(8 92% 66%)" }}>
                    FAILED
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-relaxed text-[var(--text)]">
                      {deck.failure.message}
                    </p>
                    {deck.failure.hint && (
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--faint)]">
                        {deck.failure.hint}
                      </p>
                    )}
                  </div>
                  <button className="btn shrink-0" onClick={() => setPanel("settings")}>
                    Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {demo
            ? controls && (
                <DemoBar
                  scripts={SCRIPTS}
                  active={demo}
                  running={deck.running}
                  onPick={setDemo}
                  onTake={() => sendRef.current(scriptById(demo).prompt)}
                  onReset={() => {
                    setSite(null);
                    setSiteFull(false);
                    setPanel(null);
                    speech.cancel();
                    deck.stop();
                    deck.newSession();
                  }}
                />
              )
            : !site && <ActivityTicker />}

          {demo && !controls && <DemoHint />}

          {!site && !demo && (
            <button
              onClick={() => {
                setVoiceOut((v) => !v);
                if (voiceOut) speech.cancel();
              }}
              className="glass pointer-events-auto absolute bottom-[11%] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.05]"
              title="Speak replies aloud"
            >
              <Icon
                name="bolt"
                size={11}
                style={{ color: voiceOut ? "var(--accent)" : "var(--faint)" }}
              />
              <span
                className="label"
                style={{ color: voiceOut ? "var(--accent)" : "var(--faint)" }}
              >
                VOICE {voiceOut ? "ON" : "OFF"}
                {speech.engine === "elevenlabs" && voiceOut ? " · XI" : ""}
              </span>
            </button>
          )}

          {/* Above the site frame, so you can keep talking while it is up.
              Hidden while recording — it is a control surface, not the show. */}
          <div className="absolute bottom-4 right-4 z-40" hidden={!!demo}>
            <ChatDock
              turns={deck.turns}
              tools={deck.tools}
              sessions={deck.sessions}
              sessionId={deck.sessionId}
              running={deck.running}
              listening={voice.listening}
              micSupported={voice.supported.recognition}
              interim={voice.interim}
              onSend={deck.send}
              onStop={deck.stop}
              onToggleMic={voice.toggleListening}
              onOpenSession={deck.openSession}
              onNewSession={deck.newSession}
            />
          </div>
        </main>
      </div>

      {deck.approval && <ApprovalCard approval={deck.approval} onDecide={deck.decide} />}
      {booting && <BootSequence onDone={() => setBooting(false)} />}
    </div>
  );
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
