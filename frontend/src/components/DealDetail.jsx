import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { poolActions } from "../lib/contracts";
import { formatUSDC, toUSDCUnits, shortAddr, dealStatusColor, MILESTONE_STATUS } from "../lib/format";
import { Stamp } from "./Stamp";
import { keccak256, toBytes, zeroAddress } from "viem";

function MilestoneRow({ milestone, dealId, wallet, onAction, busy }) {
  const statusLabel = MILESTONE_STATUS[milestone.status] || "Pending";
  const isBusiness = wallet.address; // fine-grained role checks happen on-chain; UI just offers the buttons

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
            Confirm receipt (payee)
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
  const [repayAmount, setRepayAmount] = useState("");

  const refresh = useCallback(() => {
    api.deal(dealId).then(setDeal).catch((e) => setError(e.message));
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
      await new Promise((r) => setTimeout(r, 1500)); // let the indexer catch up
      refresh();
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

  const handleRemit = () =>
    runAction(() =>
      poolActions.remitProfit(
        wallet.walletClient,
        wallet.publicClient,
        wallet.config.investmentPool,
        wallet.config.usdc,
        dealId,
        toUSDCUnits(repayAmount)
      )
    );

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

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <button onClick={onBack} className="text-sm text-ink-soft hover:text-ink">
        ← Back to marketplace
      </button>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
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

      {deal.profile?.pitch && <p className="mt-4 max-w-xl text-ink-soft">{deal.profile.pitch}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Target" value={`$${formatUSDC(deal.target_amount)}`} />
        <Stat label="Raised" value={`$${formatUSDC(deal.raised_amount)} (${pct}%)`} />
        <Stat label="Collateral" value={`$${formatUSDC(deal.collateral_amount)}`} />
        <Stat label="Profit share" value={`${deal.profit_share_bps / 100}%`} />
      </div>

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
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-white p-4">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Repayment amount (USDC)"
            value={repayAmount}
            onChange={(e) => setRepayAmount(e.target.value)}
            className="w-48 rounded-lg border border-ink/15 px-3 py-2 font-mono text-sm"
          />
          <button
            disabled={busy || !repayAmount}
            onClick={handleRemit}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            Remit profit share (business)
          </button>
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
            dealId={dealId}
            wallet={wallet}
            onAction={handleMilestoneAction}
            busy={busy}
          />
        ))}
      </div>

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
