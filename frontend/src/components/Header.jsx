import { shortAddr } from "../lib/format";

const ROLE_LABELS = {
  investor: "Investor",
  business: "Business",
  verifier: "Underwriter",
  supplier: "Supplier",
};

export function Header({ role, onSwitchRole, onGoHome, onProtection, wallet }) {
  const { address, connecting, connect, disconnect, error, config } = wallet;

  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/92 backdrop-blur-xl">
      <div className="page-shell flex h-[72px] items-center justify-between gap-4">
        <button onClick={onGoHome} className="flex items-center gap-2 text-left">
          <span className="brand-glyph">T</span>
          <span className="font-display text-xl font-semibold tracking-tight">transcend</span>
        </button>

        <div className="flex items-center gap-2">
          <button onClick={onProtection} className="hidden text-sm font-medium text-ink-soft hover:text-ink md:block">How investors are protected</button>
          {role && (
            <button
              onClick={onSwitchRole}
              className="hidden items-center gap-1.5 rounded-full bg-paper-dim px-3 py-1.5 text-sm font-medium text-ink-soft hover:text-ink sm:flex"
              title="Switch role"
            >
              Viewing as <span className="text-ink">{ROLE_LABELS[role]}</span>
              <span aria-hidden>↕</span>
            </button>
          )}

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
              disabled={connecting || (config && !config.deploymentReady)}
              title={config && !config.deploymentReady ? "Arc contracts awaiting deployment" : "Connect wallet"}
              className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
      {error && <div className="bg-risk/10 px-5 py-1.5 text-center text-xs text-risk">{error}</div>}
      {role && (
        <button
          onClick={onSwitchRole}
          className="block w-full bg-paper-dim px-5 py-2 text-center text-xs font-medium text-ink-soft sm:hidden"
        >
          Viewing as {ROLE_LABELS[role]} · tap to switch
        </button>
      )}
    </header>
  );
}
