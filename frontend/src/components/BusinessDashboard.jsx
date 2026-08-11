import { useEffect, useState } from "react";
import { keccak256, toBytes, zeroAddress } from "viem";
import { api } from "../lib/api";
import { registryActions, poolActions } from "../lib/contracts";
import { formatUSDC, toUSDCUnits } from "../lib/format";

export function BusinessDashboard({ wallet, onOpenDeal }) {
  const [business, setBusiness] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [regForm, setRegForm] = useState({ name: "", category: "", city: "", country: "Nigeria", regNumber: "" });

  const [dealForm, setDealForm] = useState({
    targetAmount: "500",
    collateralBps: "1000",
    profitShareBps: "2000",
    repaymentDays: "30",
    numRepayments: "3",
    repaymentCap: "0",
    milestones: [{ description: "", amount: "", payee: "" }],
  });

  useEffect(() => {
    if (!wallet.address) return;
    api
      .business(wallet.address)
      .then(setBusiness)
      .catch(() => setBusiness(null));
  }, [wallet.address]);

  if (!wallet.address) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center text-ink-soft">
        Connect a wallet to manage your business.
      </div>
    );
  }

  const handleRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      const regNumberHash = keccak256(toBytes(regForm.regNumber));
      await registryActions.registerBusiness(wallet.walletClient, wallet.publicClient, wallet.config.businessRegistry, {
        name: regForm.name,
        category: regForm.category,
        city: regForm.city,
        country: regForm.country,
        regNumberHash,
      });
      setNotice("Registered. An admin/verifier must confirm your documents before you can raise.");
      const b = await api.business(wallet.address).catch(() => null);
      setBusiness(b);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateMilestone = (idx, field, value) => {
    setDealForm((f) => {
      const milestones = [...f.milestones];
      milestones[idx] = { ...milestones[idx], [field]: value };
      return { ...f, milestones };
    });
  };

  const addMilestone = () =>
    setDealForm((f) => ({ ...f, milestones: [...f.milestones, { description: "", amount: "", payee: "" }] }));

  const removeMilestone = (idx) =>
    setDealForm((f) => ({ ...f, milestones: f.milestones.filter((_, i) => i !== idx) }));

  const handleCreateDeal = async () => {
    setBusy(true);
    setError(null);
    try {
      const targetAmount = toUSDCUnits(dealForm.targetAmount);
      const milestoneAmounts = dealForm.milestones.map((m) => toUSDCUnits(m.amount));
      const sum = milestoneAmounts.reduce((a, b) => a + b, 0n);
      if (sum !== targetAmount) {
        throw new Error("Milestone amounts must sum exactly to the target amount.");
      }
      await poolActions.createDeal(wallet.walletClient, wallet.publicClient, wallet.config.investmentPool, wallet.config.usdc, {
        targetAmount,
        collateralBps: Number(dealForm.collateralBps),
        profitShareBps: Number(dealForm.profitShareBps),
        repaymentIntervalSeconds: Number(dealForm.repaymentDays) * 86400,
        numRepayments: Number(dealForm.numRepayments),
        milestoneDescriptions: dealForm.milestones.map((m) => m.description),
        milestoneAmounts,
        milestonePayees: dealForm.milestones.map((m) => (m.payee ? m.payee : zeroAddress)),
        repaymentCapUSDC: toUSDCUnits(dealForm.repaymentCap || "0"),
      });
      setNotice("Deal created. It's live on the marketplace once investors start funding it.");
      const b = await api.business(wallet.address).catch(() => null);
      setBusiness(b);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Business dashboard</h1>

      {notice && <div className="mt-4 rounded-lg bg-verified/10 px-4 py-3 text-sm text-verified">{notice}</div>}
      {error && <div className="mt-4 rounded-lg bg-risk/10 px-4 py-3 text-sm text-risk">{error}</div>}

      {!business ? (
        <section className="mt-8 rounded-xl border border-ink/10 bg-white p-6">
          <h2 className="font-display text-xl font-semibold">Register your business</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Registration is free and reversible. You can't raise capital until an admin/verifier confirms your documents.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Business name" value={regForm.name} onChange={(v) => setRegForm({ ...regForm, name: v })} />
            <Field label="Category" value={regForm.category} onChange={(v) => setRegForm({ ...regForm, category: v })} />
            <Field label="City" value={regForm.city} onChange={(v) => setRegForm({ ...regForm, city: v })} />
            <Field label="Country" value={regForm.country} onChange={(v) => setRegForm({ ...regForm, country: v })} />
            <Field
              label="CAC registration number"
              value={regForm.regNumber}
              onChange={(v) => setRegForm({ ...regForm, regNumber: v })}
              className="sm:col-span-2"
            />
          </div>
          <button
            disabled={busy}
            onClick={handleRegister}
            className="mt-4 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            Register
          </button>
        </section>
      ) : (
        <section className="mt-8 rounded-xl border border-ink/10 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-semibold">{business.business_name}</h2>
              <p className="text-sm text-ink-soft">
                {business.verified ? "Verified" : "Awaiting verification"} · Tier reflects {business.completed_deals}{" "}
                completed / {business.defaulted_deals} defaulted deals
              </p>
            </div>
            {business.frozen && (
              <span className="rounded-full bg-risk/10 px-3 py-1 text-xs font-semibold text-risk">Frozen — contact admin</span>
            )}
          </div>

          {business.deals?.length > 0 && (
            <div className="mt-4 space-y-2">
              {business.deals.map((d) => (
                <button
                  key={d.deal_id}
                  onClick={() => onOpenDeal(d.deal_id)}
                  className="block w-full rounded-lg bg-paper-dim px-3 py-2 text-left text-sm hover:bg-paper-dim/70"
                >
                  Deal #{d.deal_id} — ${formatUSDC(d.raised_amount)}/${formatUSDC(d.target_amount)} raised
                </button>
              ))}
            </div>
          )}

          {business.verified && !business.frozen && (
            <div className="mt-6 border-t border-ink/10 pt-6">
              <h3 className="font-display text-lg font-semibold">Create a new deal</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Target amount (USDC)"
                  value={dealForm.targetAmount}
                  onChange={(v) => setDealForm({ ...dealForm, targetAmount: v })}
                />
                <Field
                  label="Collateral (bps, 1000=10%)"
                  value={dealForm.collateralBps}
                  onChange={(v) => setDealForm({ ...dealForm, collateralBps: v })}
                />
                <Field
                  label="Profit share (bps, 2000=20%)"
                  value={dealForm.profitShareBps}
                  onChange={(v) => setDealForm({ ...dealForm, profitShareBps: v })}
                />
                <Field
                  label="Repayment interval (days)"
                  value={dealForm.repaymentDays}
                  onChange={(v) => setDealForm({ ...dealForm, repaymentDays: v })}
                />
                <Field
                  label="Number of repayments"
                  value={dealForm.numRepayments}
                  onChange={(v) => setDealForm({ ...dealForm, numRepayments: v })}
                />
                <Field
                  label="Repayment cap (0 = uncapped)"
                  value={dealForm.repaymentCap}
                  onChange={(v) => setDealForm({ ...dealForm, repaymentCap: v })}
                />
              </div>

              <h4 className="mt-4 text-sm font-semibold">Milestones (must sum to target)</h4>
              <div className="mt-2 space-y-2">
                {dealForm.milestones.map((m, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg bg-paper-dim p-3 sm:grid-cols-[2fr_1fr_1.4fr_auto]">
                    <input
                      placeholder="Description"
                      value={m.description}
                      onChange={(e) => updateMilestone(idx, "description", e.target.value)}
                      className="rounded-md border border-ink/15 px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder="Amount"
                      value={m.amount}
                      onChange={(e) => updateMilestone(idx, "amount", e.target.value)}
                      className="rounded-md border border-ink/15 px-2 py-1.5 font-mono text-sm"
                    />
                    <input
                      placeholder="Payee address (optional)"
                      value={m.payee}
                      onChange={(e) => updateMilestone(idx, "payee", e.target.value)}
                      className="rounded-md border border-ink/15 px-2 py-1.5 font-mono text-sm"
                    />
                    <button onClick={() => removeMilestone(idx)} className="text-xs text-risk">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addMilestone} className="mt-2 text-xs font-medium text-ochre">
                + Add milestone
              </button>

              <button
                disabled={busy}
                onClick={handleCreateDeal}
                className="mt-5 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                Create deal (posts collateral now)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, value, onChange, className = "" }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-ink-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ink/15 px-3 py-2"
      />
    </label>
  );
}
