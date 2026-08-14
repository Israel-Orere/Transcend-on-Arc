import { useEffect, useMemo, useState } from "react";
import { keccak256, toBytes } from "viem";
import { api } from "../lib/api";
import { registryActions } from "../lib/contracts";
import { formatUSDC, shortAddr, toUSDCUnits } from "../lib/format";

const INITIAL = { revenue: "18000", grossProfit: "5400", ebitda: "2400", inflows: "1500", debt: "700", coverage: "94", stability: "83", months: "12", grade: "2", decision: "2" };

export function UnderwriterDashboard({ wallet }) {
  const [applications, setApplications] = useState([]);
  const [verifier, setVerifier] = useState(null);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = async () => {
    const [queue, verifiers] = await Promise.all([api.applications().catch(() => []), api.verifiers().catch(() => [])]);
    setApplications(queue);
    if (wallet.address) setVerifier(verifiers.find((v) => v.address === wallet.address.toLowerCase()) || null);
  };
  useEffect(() => { refresh(); }, [wallet.address]);
  const selected = useMemo(() => applications.find((a) => a.business_address === selectedAddress) || applications[0] || null, [applications, selectedAddress]);
  useEffect(() => {
    if (!selected) return;
    const display = (raw, fallback) => raw ? (Number(raw) / 1_000_000).toString() : fallback;
    setForm((current) => ({ ...current,
      revenue: display(selected.reported_revenue_usdc, current.revenue),
      grossProfit: display(selected.reported_gross_profit_usdc, current.grossProfit),
      ebitda: display(selected.reported_ebitda_usdc, current.ebitda),
      debt: display(selected.existing_debt_usdc, current.debt),
    }));
  }, [selected?.business_address]);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const publish = async () => {
    if (!selected || !wallet.address) return;
    setBusy(true); setMessage(null);
    try {
      if (!selected.verified) {
        await registryActions.verifyBusiness(wallet.walletClient, wallet.publicClient, wallet.config.businessRegistry, selected.business_address);
      }
      const documentHash = keccak256(toBytes(selected.document_manifest || "[]"));
      const reportPayload = JSON.stringify({ business: selected.business_address, ...form, version: 1 });
      await registryActions.publishUnderwritingReport(wallet.walletClient, wallet.publicClient, wallet.config.businessRegistry, {
        business: selected.business_address, dataRoomHash: documentHash, reportHash: keccak256(toBytes(reportPayload)),
        verifiedRevenueUSDC: toUSDCUnits(form.revenue), grossProfitUSDC: toUSDCUnits(form.grossProfit),
        ebitdaUSDC: toUSDCUnits(form.ebitda), averageMonthlyBankInflowsUSDC: toUSDCUnits(form.inflows),
        existingDebtUSDC: toUSDCUnits(form.debt), bankCoverageBps: Math.round(Number(form.coverage) * 100),
        cashFlowStabilityBps: Math.round(Number(form.stability) * 100), statementMonths: Number(form.months),
        riskGrade: Number(form.grade), validUntil: BigInt(Math.floor(Date.now() / 1000) + 180 * 86400), decision: Number(form.decision),
      });
      setMessage({ type: "ok", text: "Underwriting decision published on Arc. The approved business will enter the market after indexing." });
      setTimeout(refresh, 3500);
    } catch (e) { setMessage({ type: "error", text: e.shortMessage || e.message }); }
    finally { setBusy(false); }
  };

  if (!wallet.address) return <div className="page-shell py-24 text-center text-ink-soft">Connect a registered underwriter wallet to open the review desk.</div>;
  return <main className="page-shell pb-20 pt-10"><div className="page-kicker">Independent underwriting network</div><div className="underwriter-heading mt-2"><div><h1 className="page-title">Turn records into investable truth.</h1><p className="page-subtitle">Reconcile claims, document judgment and publish a time-bound financial health report investors can compare.</p></div><div className="underwriter-identity"><span>{verifier?.active ? "Active underwriter" : "Credential required"}</span><strong>{verifier?.name || shortAddr(wallet.address)}</strong><small>{verifier?.underwriting_reports_published || 0} reports · {verifier?.underwritings_linked_to_default || 0} linked defaults</small></div></div>
    {message && <div className={`notice ${message.type === "error" ? "notice-risk" : "notice-ok"}`}>{message.text}</div>}
    <section className="underwriter-layout mt-8"><aside className="queue-panel"><div className="queue-title"><span>Application queue</span><b>{applications.length}</b></div>{applications.length === 0 ? <p className="queue-empty">No applications have been submitted yet.</p> : applications.map((a) => <button key={a.business_address} className={selected?.business_address === a.business_address ? "active" : ""} onClick={() => setSelectedAddress(a.business_address)}><span><strong>{a.legal_name || a.business_name}</strong><small>{a.sector} · {a.city}</small></span><b>${Number(BigInt(a.requested_usdc || 0) / 1_000_000n).toLocaleString()}</b></button>)}</aside>
      {selected ? <div className="surface review-workbench"><div className="review-banner"><div><div className="section-label light">Evidence review</div><h2>{selected.legal_name || selected.business_name}</h2><p>{selected.years_operating} years operating · {selected.employees} employees · {selected.country}</p></div><span>{selected.status}</span></div><div className="reported-strip"><Metric label="Reported revenue" value={`$${formatUSDC(selected.reported_revenue_usdc)}`}/><Metric label="Reported EBITDA" value={`$${formatUSDC(selected.reported_ebitda_usdc)}`}/><Metric label="Existing debt" value={`$${formatUSDC(selected.existing_debt_usdc)}`}/><Metric label="Documents" value={String(JSON.parse(selected.document_manifest || "[]").length)}/></div><div className="review-body"><div className="section-label">Normalized assessment</div><h3 className="section-title">Publish only what the evidence supports.</h3><div className="assessment-grid"><Money label="Verified annual revenue" field="revenue" form={form} update={update}/><Money label="Verified gross profit" field="grossProfit" form={form} update={update}/><Money label="Normalized EBITDA" field="ebitda" form={form} update={update}/><Money label="Average monthly bank inflows" field="inflows" form={form} update={update}/><Money label="Existing debt" field="debt" form={form} update={update}/><Input label="Statement months" field="months" form={form} update={update}/><Input label="Revenue reconciliation (%)" field="coverage" form={form} update={update}/><Input label="Cash-flow stability (%)" field="stability" form={form} update={update}/><label className="field"><span>Risk grade</span><select value={form.grade} onChange={(e) => update("grade", e.target.value)}><option value="1">A · Strongest</option><option value="2">B · Strong</option><option value="3">C · Moderate</option><option value="4">D · Elevated</option><option value="5">E · High</option></select></label><label className="field"><span>Decision</span><select value={form.decision} onChange={(e) => update("decision",e.target.value)}><option value="2">Approve for market</option><option value="3">Watchlist</option><option value="1">Decline</option></select></label></div><div className="underwriting-controls"><div><strong>Accountability follows this report</strong><p>Your wallet, evidence commitment, report version and future default links remain public.</p></div><button className="button-primary" disabled={busy || !verifier?.active} onClick={publish}>{busy ? "Publishing…" : "Sign underwriting decision"}</button></div></div></div> : <div className="surface p-10 text-center text-ink-soft">Select an application to begin.</div>}
    </section></main>;
}

function Metric({ label,value }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function Input({ label,field,form,update }) { return <label className="field"><span>{label}</span><input type="number" value={form[field]} onChange={(e)=>update(field,e.target.value)}/></label>; }
function Money({ label,field,form,update }) { return <label className="field"><span>{label}</span><div className="money-input"><b>$</b><input value={form[field]} onChange={(e)=>update(field,e.target.value)}/></div></label>; }
