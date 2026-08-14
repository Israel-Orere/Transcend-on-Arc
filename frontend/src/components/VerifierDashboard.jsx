import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { poolActions } from "../lib/contracts";
import { formatUSDC, shortAddr } from "../lib/format";

export function VerifierDashboard({ wallet, onOpenDeal }) {
  const [deals, setDeals] = useState([]);
  const [verifierInfo, setVerifierInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.deals().then(setDeals).catch(() => {});
    if (wallet.address) {
      api
        .verifiers()
        .then((vs) => setVerifierInfo(vs.find((v) => v.address.toLowerCase() === wallet.address.toLowerCase())))
        .catch(() => {});
    }
  }, [wallet.address]);

  if (!wallet.address) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center text-ink-soft">
        Connect a wallet registered as a verifier to review evidence.
      </div>
    );
  }

  const attest = async (dealId) => {
    setBusy(true);
    setError(null);
    try {
      await poolActions.attestMilestone(wallet.walletClient, wallet.publicClient, wallet.config.investmentPool, dealId);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Verifier dashboard</h1>

      {verifierInfo ? (
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-soft">
          <span>
            <strong className="text-ink">{verifierInfo.attestations_given}</strong> attestations given
          </span>
          <span>
            <strong className={verifierInfo.attestations_linked_to_default > 0 ? "text-risk" : "text-ink"}>
              {verifierInfo.attestations_linked_to_default}
            </strong>{" "}
            linked to a later default
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-risk">
          This wallet ({shortAddr(wallet.address)}) is not a registered verifier — attestation calls will revert.
        </p>
      )}

      {error && <div className="mt-4 rounded-lg bg-risk/10 px-4 py-3 text-sm text-risk">{error}</div>}

      <h2 className="mt-8 font-display text-xl font-semibold">Active deals</h2>
      <p className="text-sm text-ink-soft">
        Open a deal to review its evidence hash and milestone detail before attesting.
      </p>
      <div className="mt-4 space-y-2">
        {deals
          .filter((d) => d.status_name === "Active")
          .map((d) => (
            <div key={d.deal_id} className="flex items-center justify-between rounded-lg border border-ink/10 bg-white p-3">
              <button onClick={() => onOpenDeal(d.deal_id)} className="text-left text-sm hover:underline">
                Deal #{d.deal_id} — ${formatUSDC(d.raised_amount)} raised, milestone {d.current_milestone_index + 1}
              </button>
              <button
                disabled={busy}
                onClick={() => attest(d.deal_id)}
                className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:bg-paper-dim disabled:opacity-50"
              >
                Attest current milestone
              </button>
            </div>
          ))}
        {deals.filter((d) => d.status_name === "Active").length === 0 && (
          <div className="rounded-xl border border-dashed border-ink/15 px-6 py-10 text-center text-ink-soft">
            No active deals awaiting attestation right now.
          </div>
        )}
      </div>

      <h2 className="mt-10 font-display text-xl font-semibold">Revenue-report queue</h2>
      <p className="text-sm text-ink-soft">Attest only after reconciling the committed period against the agreed POS, bank and invoice evidence.</p>
      <div className="mt-4 space-y-2">
        {deals.filter((d) => d.status_name === "Repaying").map((d) => (
          <div key={d.deal_id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white p-3">
            <button onClick={() => onOpenDeal(d.deal_id)} className="text-left text-sm hover:underline">Deal #{d.deal_id} · reporting period {Number(d.repayments_made || 0) + 1}</button>
            <button onClick={() => onOpenDeal(d.deal_id)} className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-medium hover:bg-paper-dim">Open &amp; review evidence</button>
          </div>
        ))}
        {deals.filter((d) => d.status_name === "Repaying").length === 0 && <div className="rounded-xl border border-dashed border-ink/15 px-6 py-8 text-center text-sm text-ink-soft">No revenue periods awaiting review.</div>}
      </div>
    </div>
  );
}
