"use client";

/**
 * Line icons, drawn here rather than installed.
 *
 * Nine glyphs is not a dependency, and a stroke width chosen to match the
 * hairlines everywhere else is worth more than any icon set's house style.
 */

const PATHS: Record<string, string> = {
  deck: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 19.6 12 21c-2.5-1.4-3.8-5.6-3.8-9S9.5 5.4 12 3z",
  sessions: "M4 6h16M4 12h16M4 18h10",
  memory: "M12 3v18M7 6.5a3 3 0 000 5.2M17 6.5a3 3 0 010 5.2M7 12a3.2 3.2 0 000 6h1M17 12a3.2 3.2 0 010 6h-1",
  cron: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5V12l3 1.8",
  tools: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  approvals: "M12 3l7 3v5.5c0 4-3 7.6-7 9.5-4-1.9-7-5.5-7-9.5V6l7-3zM9 12l2.2 2.2L15.5 10",
  skills: "M5 4.5A1.5 1.5 0 016.5 3H19v18H6.5A1.5 1.5 0 015 19.5zM8 3v18",
  soul: "M12 2.5l2.3 5.6 5.7 2.4-5.7 2.4L12 18.5l-2.3-5.6L4 10.5l5.7-2.4zM18.5 16.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z",
  settings:
    "M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.4-2.4 1a7.7 7.7 0 00-1.7-1l-.4-2.6h-3.9l-.4 2.6a7.7 7.7 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.6h3.9l.4-2.6c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4z",
  mic: "M12 3.5a2.8 2.8 0 012.8 2.8v5.4a2.8 2.8 0 11-5.6 0V6.3A2.8 2.8 0 0112 3.5zM5.8 11.2a6.2 6.2 0 0012.4 0M12 17.6V21",
  send: "M4 12l16-7.5-4 7.5 4 7.5z",
  stop: "M7 7h10v10H7z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  expand: "M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5",
  chevronLeft: "M14.5 5.5L8 12l6.5 6.5",
  chevronRight: "M9.5 5.5L16 12l-6.5 6.5",
  chevronDown: "M6 9.5l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  play: "M7 4.5l12 7.5-12 7.5z",
  pause: "M8 5h3v14H8zM13 5h3v14h-3z",
  trash: "M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13",
  refresh: "M20 12a8 8 0 11-2.6-5.9M20 4v4.5h-4.5",
  bolt: "M13.5 2.5L5 13.5h6L10.5 21.5 19 10.5h-6z",
};

export default function Icon({
  name,
  size = 17,
  className = "",
  strokeWidth = 1.4,
  style,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  const d = PATHS[name] ?? PATHS.deck;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
