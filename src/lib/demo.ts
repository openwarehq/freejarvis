/**
 * Demo mode — a scripted take.
 *
 * What this is: the deck, running its real components, driven by a tape
 * instead of by a model. The orb is the orb. The voice is really ElevenLabs.
 * The site really is the file on your disk in a real iframe. The only thing
 * that comes off this script is *what the agent decides to do* — and every
 * step below is something the agent genuinely does when you ask it normally.
 *
 * What it is for: filming. A free-tier model returns an empty response about
 * one turn in ten and takes a variable two to six seconds to think, which is
 * survivable when you are working and fatal when you are on take nine. This
 * makes the beat land on the same frame every time.
 *
 * What it is not: a substitute for the thing working. It lives behind
 * `?demo=1`, it streams from `/api/demo` rather than `/api/chat`, and nothing
 * reaches it by accident. If you are demoing this to someone who wants to know
 * whether it works, close it and just use it — that is the better demo.
 */

export type DemoStep =
  | { kind: "say"; text: string }
  | {
      kind: "tool";
      name: string;
      args: Record<string, unknown>;
      runMs?: number;
      output?: string;
      /**
       * Run the real tool and stream what it really returned.
       *
       * The rest of a script is a tape because a free-tier model is slow and
       * occasionally empty, and neither belongs in take nine. But a step whose
       * whole point is that it *did the thing* cannot be a tape — a reel take
       * that narrates an upload without uploading is not a demo of anything.
       * So this one step comes off the tape: the tool runs, the deck waits for
       * it, and the line the agent reads back is the line the tool produced.
       */
      live?: boolean;
    }
  | { kind: "pause"; ms: number };

export type DemoScript = {
  id: string;
  label: string;
  /** Shown in the composer as though it were typed. */
  prompt: string;
  steps: DemoStep[];
};

/**
 * Placeholders a `say` line can use. They are filled in from the live system
 * at stream time, so the status report is the actual status report — the
 * counts it reads out are the tools really loaded and the jobs really armed.
 * Written as words rather than digits because they are going to be spoken.
 *
 *   {tools}  {memories}  {jobs}  {sessions}  {sites}  {voice}
 */
export const PLACEHOLDER = /\{(tools|memories|jobs|sessions|sites|voice)\}/g;

export const SCRIPTS: DemoScript[] = [
  {
    id: "reel",
    label: "Post a reel",
    // The one take that starts without a word being said. ⌘⇧E on the deck runs
    // it, because the whole point of this script is the thing you want done
    // while you are busy filming something else.
    prompt: "Send the next one out.",
    steps: [
      { kind: "pause", ms: 150 },
      { kind: "say", text: "Got it sir — I'll post this video now." },
      {
        kind: "tool",
        name: "post_reel",
        args: {},
        // Live. A reel take that narrates an upload without uploading is not a
        // demo of anything — this step really opens the browser, really
        // attaches the file, and really stops at Share.
        live: true,
      },
      { kind: "say", text: "Done sir — it's filled in and waiting. Share is the only thing left, and I haven't touched it." },
    ],
  },

  {
    id: "yacht",
    label: "Yacht listing",
    prompt: "Morning. Where are we?",
    // The budget is characters, not steps: this voice reads about fourteen a
    // second, so the whole take is roughly a hundred and seventy of them.
    // Em dashes rather than full stops where a beat is wanted — a second
    // sentence is a second clip, and clips are where seams live.
    steps: [
      { kind: "pause", ms: 150 },
      { kind: "say", text: "Hey sir — how are you doing?" },
      { kind: "say", text: "All systems ready — {tools} online, {jobs} armed." },
      { kind: "say", text: "Pulling up the yacht site now." },
      {
        kind: "tool",
        name: "open_site",
        args: { name: "azur" },
        runMs: 400,
        output: 'Opened "azur" on the deck — AZUR — Twenty-eight metres of horizon.',
      },
      { kind: "say", text: "AZUR — twenty-eight metres, Saint-Tropez, ready for listing." },
    ],
  },
  {
    id: "portfolio",
    label: "Site walkthrough",
    prompt: "Run me through the site work.",
    // Three sites, chosen for how differently they look rather than for what
    // they sell: deep navy and photographic, then bright cream and minimal,
    // then electric cyan on black. The window swapping between them is the
    // whole point, and three dark sites in a row would show nothing.
    //
    // Each `open_site` is queued *before* the line that names it, so the site
    // is already on screen while it is being described.
    steps: [
      { kind: "pause", ms: 150 },
      { kind: "say", text: "Of course — pulling up the site work." },
      { kind: "tool", name: "open_site", args: { name: "azur" }, runMs: 300,
        output: 'Opened "azur" — AZUR — Twenty-eight metres of horizon.' },
      { kind: "say", text: "AZUR — yacht charter, Saint-Tropez." },
      { kind: "tool", name: "open_site", args: { name: "sable" }, runMs: 300,
        output: 'Opened "sable" — SABLE — Softness, engineered.' },
      { kind: "say", text: "SABLE — loungewear, cotton and silk." },
      { kind: "tool", name: "open_site", args: { name: "volt" }, runMs: 300,
        output: 'Opened "volt" — VOLT — Drive on light.' },
      { kind: "say", text: "VOLT — all-electric, five hundred miles." },
      { kind: "say", text: "Three of {sites} — say the word for any of the rest." },
    ],
  },
  {
    id: "brief",
    label: "Morning brief",
    prompt: "What's on today?",
    steps: [
      { kind: "pause", ms: 380 },
      { kind: "say", text: "Morning." },
      {
        kind: "tool",
        name: "recall",
        args: { query: "today" },
        runMs: 900,
        output: "- [project] Ships one open-source drop every day. The repo is slopsource.",
      },
      { kind: "pause", ms: 260 },
      {
        kind: "say",
        text: "Drop twelve goes out today. The listing site is the only thing still open.",
      },
      { kind: "say", text: "Shall I pull it up?" },
    ],
  },
];

export function scriptById(id: string | null | undefined): DemoScript {
  return SCRIPTS.find((s) => s.id === id) ?? SCRIPTS[0];
}

const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/**
 * "nine tools", "one job", "no memories".
 *
 * Small numbers go out as words because a voice reading "9" and a voice
 * reading "nine" are not the same performance, and the plural has to agree or
 * the whole line sounds machine-written — which it is, and shouldn't sound it.
 */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n <= 12 ? WORDS[n] : n} ${n === 1 ? singular : plural}`;
}

/**
 * Chunk a sentence the way a model streams one.
 *
 * Not character by character — real providers emit rough word fragments, and
 * the caption's sentence splitter is tuned for that shape. Streaming it any
 * other way would make the take look less like the product, not more.
 */
export function chunk(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (word.length > 7 && !/^\s+$/.test(word)) {
      out.push(word.slice(0, 4), word.slice(4));
    } else {
      out.push(word);
    }
  }
  return out;
}
