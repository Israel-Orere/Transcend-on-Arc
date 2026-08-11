import { shortAddr } from "../lib/format";

const TABS = [
  { id: "marketplace", label: "Marketplace" },
  { id: "business", label: "Business" },
  { id: "verifier", label: "Verifier" },
];

export function Header({ tab, setTab, wallet }) {
  const { address, connecting, connect, disconnect, error } = wallet;

  return (
    <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <button onClick={() => setTab("marketplace")} className="flex items-center gap-2 text-left">
          <span className="stamp h-9 w-9 text-[9px] font-bold" style={{ color: "var(--color-ink)" }}>
            T
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Transcend</span>
        </button>

        <nav className="hidden gap-1 rounded-full bg-paper-dim p-1 sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {address ? (
            <button
              onClick={disconnect}
              className="rounded-full border border-ink/15 px-3 py-1.5 font-mono text-xs text-ink-soft hover:border-ink/30"
              title="Disconnect"
            >
              {shortAddr(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
      {error && <div className="bg-risk/10 px-5 py-1.5 text-center text-xs text-risk">{error}</div>}
      <nav className="flex gap-1 overflow-x-auto bg-paper-dim px-3 py-2 sm:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              tab === t.id ? "bg-ink text-paper" : "text-ink-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
