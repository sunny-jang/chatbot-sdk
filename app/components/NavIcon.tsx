/** 18px stroke icons for navigation. One weight, one grid, no emoji glyphs. */
const paths: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5",
  inbox:
    "M4 12h4l2 3h4l2-3h4M4 12v7h16v-7M4 12l3-7h10l3 7",
  requests: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  customers: "M3 21V8l7-5 7 5v13M10 21v-6h0M3 12h7M13 12h4",
  demo: "M4 5h16v11H4zM9 20h6M12 16v4",
  bots: "M5 8h14v10H5zM9 12h.01M15 12h.01M12 4v4M9 18v2M15 18v2",
  analytics: "M4 20h16M7 16v-5M12 16V8M17 16v-8",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-6l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 0 0 1.7 1l.3 2.6h6l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z",
  plan: "M4 7h16v10H4zM4 11h16M8 15h3",
  docs: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  qa: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5",
  test: "M7 4v16l12-8z",
  logs: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  guide: "M12 17h.01M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  install: "M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14",
  admin: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};
export default function NavIcon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.requests} />
    </svg>
  );
}
