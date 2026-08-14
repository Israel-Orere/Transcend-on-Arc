import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { poolActions } from "../lib/contracts";
import { formatUSDC, toUSDCUnits, shortAddr, dealStatusColor, MILESTONE_STATUS } from "../lib/format";
import { Stamp } from "./Stamp";
import { keccak256, toBytes, zeroAddress } from "viem";

function MilestoneRow({ milestone, onAction, busy }) {
  const statusLabel = MILESTONE_STATUS[milestone.status] || "Pending";
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{milestone.description}</div>
          <div className="mt-0.5 font-mono text-sm text-ink-soft">${formatUSDC(milestone.amount)}</div>
        </div>
        <span className="rounded-full bg-paper-dim px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        {milestone.payee && milestone.payee !== zeroAddress ? (
          <span>
            Pays: <span className="font-mono">{shortAddr(milestone.payee)}</span>
          </span>
        ) : (
          <span>Pays: business directly</span>
        )}
        {milestone.payee_is_onchain_verified ? (
          milestone.payee_confirmed ? (
            <Stamp label="payee confirmed" size="sm" />
          ) : (
            <span className="text-ochre">awaiting payee confirmation</span>
          )
        ) : (
          <span className="text-risk">untraceable payee — needs supermajority</span>
        )}
        {milestone.verifier && milestone.verifier !== zeroAddress && <Stamp label="verifier attested" size="sm" />}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {milestone.status === 0 && (
          <button
            disabled={busy}
            onClick={() => onAction("requestMilestoneRelease", milestone.milestone_index)}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-50"
          >
            Submit evidence (business)
          </button>
        )}
        {milestone.status === 1 && (
          <button
            disabled={busy}
            onClick={() => onAction("attestMilestone", milestone.milestone_index)}
            className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:bg-paper-dim disabled:opacity-50"
          >
            Attest (verifier)
          </button>
        )}
        {milestone.payee_is_onchain_verified && !milestone.payee_confirmed && (
          <button
            disabled={busy}
            onClick={() => onAction("confirmReceipt", milestone.milestone_index)}
            className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:bg-paper-dim disabled:opacity-50"
          >
            Confirm order / fulfilment (payee)
          </button>
        )}
        {milestone.status === 2 && (
          <button
            disabled={busy}
            onClick={() => onAction("approveMilestoneRelease", milestone.milestone_index)}
            className="rounded-full bg-ochre px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
          >
            Approve release (investor)
          </button>
        )}
      </div>
    </div>
  );
}

export function DealDetail({ dealId, wallet, onBack }) {
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [investAmount, setInvestAmount] = useState("");
  const [grossRevenue, setGrossRevenue] = useState("");

  const refresh = useCallback(() => {
    return api.deal(dealId).then(setDeal).catch((e) => setError(e.message));
  }, [dealId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (fn) => {
    if (!wallet.address || !wallet.walletClient || !wallet.config) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
      // The tx is confirmed on-chain here, but the backend indexer polls on
      // an interval and may not have caught up on the first check -- retry
      // a few times rather than a single fixed wait that can race it.
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 1200));
        await refresh();
      }
    } catch (e) {
      setError(e.shortMessage || e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleMilestoneAction = (action) => {
    const { walletClient, publicClient, config } = wallet;
    if (action === "requestMilestoneRelease") {
      const evidenceHash = keccak256(toBytes(`evidence-${dealId}-${Date.now()}`));
      return runAction(() =>
        poolActions.requestMilestoneRelease(walletClient, publicClient, config.investmentPool, dealId, evidenceHash)
      );
    }
    if (action === "attestMilestone") {
      return runAction(() => poolActions.attestMilestone(walletClient, publicClient, config.investmentPool, dealId));
    }
    if (action === "confirmReceipt") {
      return runAction(() => poolActions.confirmReceipt(walletClient, publicClient, config.investmentPool, dealId));
    }
    if (action === "approveMilestoneRelease") {
      return runAction(() =>
        poolActions.approveMilestoneRelease(walletClient, publicClient, config.investmentPool, dealId)
      );
    }
  };

  const handleInvest = () =>
    runAction(() =>
      poolActions.invest(
        wallet.walletClient,
        wallet.publicClient,
        wallet.config.investmentPool,
        wallet.config.usdc,
        dealId,
        toUSDCUnits(investAmount)
      )
    );

  const handleSubmitRevenue = () => {
    const evidenceHash = keccak256(toBytes(`revenue-${dealId}-${Date.now()}`));
    return runAction(() =>
      poolActions.submitRevenueReport(
        wallet.walletClient,
        wallet.publicClient,
        wallet.config.investmentPool,
        dealId,
        toUSDCUnits(grossRevenue),
        evidenceHash
      )
    );
  };

  const handleAttestRevenue = () =>
    runAction(() => poolActions.attestRevenueReport(
      wallet.walletClient, wallet.publicClient, wallet.config.investmentPool, dealId
    ));

  const handleSettleRevenue = (amountDue) =>
    runAction(() => poolActions.settleRevenueShare(
      wallet.walletClient,
      wallet.publicClient,
      wallet.config.investmentPool,
      wallet.config.usdc,
      dealId,
      BigInt(amountDue)
    ));

  const handleWithdraw = () =>
    runAction(() => poolActions.withdraw(wallet.walletClient, wallet.publicClient, wallet.config.investmentPool, dealId));

  if (!deal) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <button onClick={onBack} className="text-sm text-ink-soft hover:text-ink">
          ← Back to marketplace
        </button>
        {error ? <div className="mt-6 text-risk">{error}</div> : <div className="mt-6 text-ink-soft">Loading…</div>}
      </div>
    );
  }

  const pct = deal.target_amount === "0" ? 0 : Math.round((Number(deal.raised_amount) / Number(deal.target_amount)) * 100);
  const currentPeriod = Number(deal.repayments_made || 0) + 1;
  const currentReport = deal.revenue_reports?.find((r) => Number(r.period) === currentPeriod);

  return (
    <div className="page-shell max-w-6xl py-10">
      <button onClick={onBack} className="text-sm text-ink-soft hover:text-ink">
        ← Back to marketplace
      </button>

      <div className="deal-heading mt-5">
        <div>
          <div className="page-kicker">Controlled growth deal · Arc #{deal.deal_id}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {deal.business?.business_name || shortAddr(deal.business_address)}
          </h1>
          <p className="mt-1 text-ink-soft">
            Deal #{deal.deal_id} · {deal.business?.city}, {deal.business?.country}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${dealStatusColor(deal.status_name)}`}>
          {deal.status_name}
        </span>
      </div>

      {deal.profile?.pitch && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">{deal.profile.pitch}</p>}

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Target" value={`$${formatUSDC(deal.target_amount)}`} />
        <Stat label="Raised" value={`$${formatUSDC(deal.raised_amount)} (${pct}%)`} />
        <Stat label="Collateral" value={`$${formatUSDC(deal.collateral_amount)}`} />
        <Stat label="Verified revenue share" value={`${deal.profit_share_bps / 100}%`} />
      </div>

      <ProtectionSnapshot deal={deal} />

      {deal.status_name === "Raising" && (
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-white p-4">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Amount (USDC)"
            value={investAmount}
            onChange={(e) => setInvestAmount(e.target.value)}
            className="w-40 rounded-lg border border-ink/15 px-3 py-2 font-mono text-sm"
          />
          <button
            disabled={busy || !investAmount}
            onClick={handleInvest}
            className="rounded-full bg-ochre px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
          >
            Invest
          </button>
          <span className="text-xs text-ink-soft">Max 40% of target per wallet, min 3 distinct investors to activate.</span>
        </div>
      )}

      {deal.status_name === "Repaying" && (
        <div className="surface mt-7 p-5">
          <div className="section-label">Revenue period {currentPeriod}</div>
          <h2 className="mt-1 font-display text-xl font-semibold">Contract-calculated distribution</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">The merchant reports gross collections with a private evidence commitment. An assigned verifier confirms the period, then the contract calculates the exact investor share.</p>
          <div className="revenue-steps mt-5">
            <div className={currentReport ? "revenue-step complete" : "revenue-step active"}><b>1</b><span><strong>Submit collections</strong><small>{currentReport ? `$${formatUSDC(currentReport.gross_revenue_usdc)} reported` : "Merchant + evidence hash"}</small></span></div>
            <div className={currentReport?.attested ? "revenue-step complete" : currentReport ? "revenue-step active" : "revenue-step"}><b>2</b><span><strong>Independent attestation</strong><small>{currentReport?.attested ? "Verifier approved" : "Cannot be self-approved"}</small></span></div>
            <div className={currentReport?.settled ? "revenue-step complete" : currentReport?.attested ? "revenue-step active" : "revenue-step"}><b>3</b><span><strong>Settle exact share</strong><small>{currentReport ? `$${formatUSDC(currentReport.amount_due_usdc)} due` : `${deal.profit_share_bps / 100}% of verified collections`}</small></span></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!currentReport && <><input type="text" inputMode="decimal" placeholder="Gross collections (USDC)" value={grossRevenue} onChange={(e) => setGrossRevenue(e.target.value)} className="input-compact"/><button disabled={busy || !grossRevenue} onClick={handleSubmitRevenue} className="button-primary">Submit report (merchant)</button></>}
            {currentReport && !currentReport.attested && <button disabled={busy} onClick={handleAttestRevenue} className="button-secondary">Attest report (verifier)</button>}
            {currentReport?.attested && !currentReport.settled && <button disabled={busy} onClick={() => handleSettleRevenue(currentReport.amount_due_usdc)} className="button-primary">Pay ${formatUSDC(currentReport.amount_due_usdc)} (merchant)</button>}
            {currentReport?.settled ? <span className="tag tag-ok">Period settled on Arc</span> : null}
          </div>
        </div>
      )}

      <div className="mt-6">
        <button
          disabled={busy}
          onClick={handleWithdraw}
          className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:bg-paper-dim disabled:opacity-50"
        >
          Withdraw what's owed to me (investor)
        </button>
      </div>

      <h2 className="mt-10 font-display text-xl font-semibold">Milestones</h2>
      <div className="mt-3 space-y-3">
        {deal.milestones?.map((m) => (
          <MilestoneRow
            key={m.milestone_index}
            milestone={m}
            onAction={handleMilestoneAction}
            busy={busy}
          />
        ))}
      </div>

      <SupplierReferences endorsements={deal.endorsements || []} />

      {error && <div className="mt-4 rounded-lg bg-risk/10 px-4 py-3 text-sm text-risk">{error}</div>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-paper-dim px-3 py-2.5">
      <div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-ink-soft">{label}</div>
    </div>
  );
}

function ProtectionSnapshot({ deal }) {
  const business = deal.business || {};
  const traceable = Number(business.disbursed_traceable_usdc || 0);
  const untraceable = Number(business.disbursed_untraceable_usdc || 0);
  const tracePct = traceable + untraceable > 0 ? Math.round((traceable / (traceable + untraceable)) * 100) : 100;
  const controls = [
    [business.verified ? "Verified" : "Pending", "Business identity", business.verified ? "ok" : "warn"],
    [`$${formatUSDC(deal.collateral_amount)}`, "Merchant collateral", "ok"],
    [`${deal.milestones?.length || 0} tranches`, "Staged disbursement", "ok"],
    [`${tracePct}%`, "Historic traceable releases", tracePct >= 70 ? "ok" : "warn"],
    [`${deal.endorsements?.filter((e) => !e.revoked && !e.related_party).length || 0}`, "Independent supplier references", "neutral"],
    [deal.paused ? "Paused" : "Clear", "Emergency state", deal.paused ? "risk" : "ok"],
  ];
  return <section className="protection-snapshot mt-7"><div><div className="section-label light">Protection snapshot</div><h2>Know what protects you before investing.</h2><p>Controls reduce loss severity; they do not turn business investment into a guaranteed product.</p></div><div className="snapshot-grid">{controls.map(([value,label,tone]) => <div key={label} className={`snapshot-item ${tone}`}><strong>{value}</strong><span>{label}</span></div>)}</div></section>;
}

function SupplierReferences({ endorsements }) {
  return <section className="mt-10"><div className="section-label">Commercial reputation</div><h2 className="mt-1 font-display text-xl font-semibold">Supplier references with consequences</h2><p className="mt-1 max-w-2xl text-sm text-ink-soft">These are evidence-backed references, not anonymous votes. Related parties contribute zero weight and independent endorsers are penalised if the merchant later defaults.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{endorsements.length === 0 ? <div className="empty-card">No supplier references indexed for this merchant.</div> : endorsements.map((e) => <article className="reference-card" key={e.supplier_address}><div className="flex items-start justify-between gap-3"><div><strong>{e.supplier_name || shortAddr(e.supplier_address)}</strong><span>{e.supplier_category || "Verified supplier"}</span></div><b>{e.related_party ? "0" : e.supplier_current_weight || e.weight_at_issue}</b></div><div className="mt-4 flex flex-wrap gap-2"><span className={e.related_party ? "tag tag-warn" : "tag tag-ok"}>{e.related_party ? "Related party" : "Independent"}</span><span className="tag">{e.relationship_months} months</span><span className="tag">{e.rating}/5 trading record</span>{e.revoked ? <span className="tag tag-risk">Revoked</span> : null}</div></article>)}</div></section>;
}
