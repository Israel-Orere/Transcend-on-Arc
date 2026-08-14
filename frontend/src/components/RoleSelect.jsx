const ROLES = [
  {
    id: "investor",
    title: "I want to invest",
    blurb: "Browse verified businesses, fund a deal, and track what's owed to you.",
    cta: "Browse deals",
  },
  {
    id: "business",
    title: "I run a business",
    blurb: "Register, get verified, and raise capital in milestone-gated tranches.",
    cta: "Go to my business",
  },
  {
    id: "supplier",
    title: "I supply businesses",
    blurb: "Issue accountable commercial references and build a portable supplier reputation.",
    cta: "Open supplier desk",
  },
  {
    id: "verifier",
    title: "I'm an underwriter",
    blurb: "Verify records locally, normalize financials and approve proven businesses for market.",
    cta: "Open underwriting desk",
  },
];

export function RoleSelect({ onSelect }) {
  return (
    <main className="role-hero">
      <div className="page-shell grid items-center gap-12 py-16 lg:grid-cols-[.9fr_1.1fr] lg:py-24">
        <div>
          <div className="live-chip"><i /> Live on Arc testnet</div>
          <h1 className="role-title">Capital that moves<br/><em>only after proof.</em></h1>
          <p className="role-lead">Back established African businesses through USDC escrow, controlled releases and accountable commercial reputation.</p>
          <div className="role-proof"><div><strong>8</strong><span>control layers</span></div><div><strong>2/3</strong><span>untraceable release vote</span></div><div><strong>100%</strong><span>onchain fund history</span></div></div>
        </div>
        <div className="role-panel">
          <div className="section-label">Choose your workspace</div>
          <h2>What brings you to Transcend?</h2>
          <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
        {ROLES.map((role) => (
          <button
            key={role.id}
            onClick={() => onSelect(role.id)}
            className="role-card group"
          >
            <span className="role-index">0{ROLES.indexOf(role) + 1}</span>
            <span className="font-display text-lg font-semibold">{role.title}</span>
            <span className="mt-2 text-sm text-ink-soft">{role.blurb}</span>
            <span className="mt-4 text-sm font-medium text-ochre group-hover:underline">{role.cta} →</span>
          </button>
        ))}
          </div>
          <p className="mt-5 text-xs text-ink-soft">Role selection only personalises the interface. Contract permissions still enforce every action.</p>
        </div>
      </div>
    </main>
  );
}
