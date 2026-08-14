const CONTROLS = [
  { n: "01", title: "Qualification before capital", state: "Prevent", body: "A merchant must be identity-checked, operationally verified and unfrozen. One registration hash can bind to only one wallet, reducing clean-slate re-entry after default." },
  { n: "02", title: "Merchant skin in the game", state: "Absorb", body: "The merchant posts USDC collateral before investors contribute. A default forfeits that bond pro rata to investors." },
  { n: "03", title: "No unrestricted lump sum", state: "Limit", body: "Investor USDC remains in campaign escrow and releases only in bounded milestones. Unreleased capital never enters the merchant’s control." },
  { n: "04", title: "Independent evidence review", state: "Verify", body: "Evidence hashes are globally unique. Assigned verifiers cannot self-select friendly deals, and large releases require two distinct attestations." },
  { n: "05", title: "Higher bar when money leaves", state: "Govern", body: "Verified supplier payments require supplier confirmation and majority approval. Direct or untraceable withdrawals require a two-thirds investor supermajority." },
  { n: "06", title: "Accountable supplier references", state: "Signal", body: "Supplier endorsements expire, disclose related ownership and carry the supplier’s own reputation. A merchant default reduces each independent endorser’s future weight." },
  { n: "07", title: "Calculated revenue share", state: "Collect", body: "A merchant cannot choose an arbitrary remittance. A verifier attests the revenue period and the contract calculates the distribution from the agreed percentage." },
  { n: "08", title: "Freeze and recovery paths", state: "Respond", body: "Fraud signals can pause future releases immediately. Missed reporting makes default permissionless, freezes the merchant and distributes remaining escrow and collateral." },
];

export function ProtectionCenter({ onBrowse }) {
  return (
    <main>
      <section className="protection-hero">
        <div className="page-shell grid items-end gap-10 py-20 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <div className="page-kicker light">Investor protection centre</div>
            <h1 className="protection-title">Risk is not hidden.<br/>It is contained in layers.</h1>
            <p className="protection-lead">Transcend cannot make an offline business trustless. It limits how much can be lost, makes every approval attributable and keeps unreleased capital outside the merchant’s reach.</p>
            <button className="button-lime mt-7" onClick={onBrowse}>Explore controlled deals</button>
          </div>
          <div className="risk-boundary">
            <div className="risk-boundary-head"><span>Investor loss boundary</span><b>Illustrative</b></div>
            <div className="risk-stack"><div className="risk-safe"><strong>Unreleased escrow</strong><span>remains protected</span></div><div className="risk-buffer"><strong>Merchant collateral</strong><span>absorbs first loss</span></div><div className="risk-exposed"><strong>Released tranche</strong><span>capital genuinely at risk</span></div></div>
            <p>The contract reduces exposure. It does not guarantee recovery of money already released.</p>
          </div>
        </div>
      </section>

      <section className="page-shell py-16">
        <div className="section-label">Control architecture</div>
        <h2 className="section-title large">Eight controls before trust</h2>
        <div className="controls-grid mt-7">{CONTROLS.map((c) => <article className="control-card" key={c.n}><div className="control-card-top"><span>{c.n}</span><b>{c.state}</b></div><h3>{c.title}</h3><p>{c.body}</p></article>)}</div>
      </section>

      <section className="residual-section">
        <div className="page-shell grid gap-12 py-16 lg:grid-cols-2">
          <div><div className="section-label">What remains offchain</div><h2 className="section-title large">The contract is the control layer, not an oracle of truth.</h2><p className="section-copy mt-4">Identity review, POS and bank reconciliation, inspections, supplier ownership analysis, legal enforcement and dispute resolution require regulated partners and real-world evidence.</p></div>
          <div className="residual-list"><Residual label="Business failure" text="A genuine merchant can still underperform after receiving a tranche."/><Residual label="Revenue diversion" text="Sales routed outside monitored accounts may not appear automatically."/><Residual label="Coordinated fraud" text="Merchants, suppliers and verifiers can still collude; relationship analysis and human investigation remain essential."/><Residual label="Regulatory execution" text="A production launch requires a licensed intermediary, KYC/AML, custody and Nigerian legal review."/></div>
        </div>
      </section>
    </main>
  );
}

function Residual({ label, text }) { return <div className="residual-item"><span>!</span><div><strong>{label}</strong><p>{text}</p></div></div>; }
