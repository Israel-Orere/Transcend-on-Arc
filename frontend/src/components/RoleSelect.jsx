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
    id: "verifier",
    title: "I'm a verifier",
    blurb: "Review evidence and attest milestones before funds release.",
    cta: "Go to verifier queue",
  },
];

export function RoleSelect({ onSelect }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-5 py-16 text-center sm:py-24">
      <span className="stamp stamp-in mb-6 h-14 w-14 text-xs font-bold" style={{ color: "var(--color-ink)" }}>
        T
      </span>
      <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Transcend</h1>
      <p className="mt-3 max-w-md text-ink-soft">
        Verified, milestone-based capital for growing businesses. Tell us who you are so we can take you straight
        to what you need.
      </p>

      <div className="mt-10 grid w-full gap-4 sm:grid-cols-3">
        {ROLES.map((role) => (
          <button
            key={role.id}
            onClick={() => onSelect(role.id)}
            className="group flex flex-col items-start rounded-xl border border-ink/10 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="font-display text-lg font-semibold">{role.title}</span>
            <span className="mt-2 text-sm text-ink-soft">{role.blurb}</span>
            <span className="mt-4 text-sm font-medium text-ochre group-hover:underline">{role.cta} →</span>
          </button>
        ))}
      </div>

      <p className="mt-8 text-xs text-ink-soft">
        You can switch roles anytime from the top of the page — nothing here locks you in.
      </p>
    </div>
  );
}
