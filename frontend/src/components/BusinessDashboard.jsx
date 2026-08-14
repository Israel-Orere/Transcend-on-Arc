import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, toBytes, zeroAddress } from "viem";
import { api } from "../lib/api";
import { BusinessRegistryABI } from "../lib/chain";
import { registryActions, poolActions } from "../lib/contracts";
import { formatUSDC, riskGradeLabel, toUSDCUnits } from "../lib/format";

const EMPTY_APPLICATION = {
  name: "", category: "", city: "", country: "Nigeria", regNumber: "",
  yearsOperating: "", employees: "", requested: "500", useOfFunds: "",
  maturityMonths: "12", revenue: "", grossProfit: "", ebitda: "", debt: "0",
};

export function BusinessDashboard({ wallet, onOpenDeal }) {
  const [business, setBusiness] = useState(null);
  const [application, setApplication] = useState(null);
  const [chainRegistered, setChainRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState(1);
  const [editingApplication, setEditingApplication] = useState(false);
  const [form, setForm] = useState(EMPTY_APPLICATION);
  const [documents, setDocuments] = useState({ registration: null, statements: null, records: null });
  const [dealForm, setDealForm] = useState({
    targetAmount: "500", collateralBps: "1000", profitShareBps: "2000", repaymentDays: "30",
    numRepayments: "3", repaymentCap: "0", milestones: [{ description: "", amount: "", payee: "" }],
  });

  const refresh = useCallback(async () => {
    if (!wallet.address || !wallet.publicClient || !wallet.config?.businessRegistry) { setLoading(false); return; }
    setLoading(true);
    try {
      const chain = await wallet.publicClient.readContract({
        address: wallet.config.businessRegistry, abi: BusinessRegistryABI, functionName: "getBusiness", args: [wallet.address],
      });
      setChainRegistered(Boolean(chain.registered));
      const [indexed, savedApplication] = await Promise.all([
        api.business(wallet.address).catch(() => null), api.application(wallet.address).catch(() => null),
      ]);
      setApplication(savedApplication);
      if (indexed) setBusiness(indexed);
      else if (chain.registered) setBusiness({
        address: wallet.address.toLowerCase(), business_name: chain.businessName, category: chain.category,
        city: chain.city, country: chain.country, verified: chain.verified ? 1 : 0, frozen: chain.frozen ? 1 : 0,
        completed_deals: Number(chain.completedDeals), defaulted_deals: Number(chain.defaultedDeals),
        deals: [], underwriting: null, syncing: true,
      });
      else setBusiness(null);
    } catch (e) { setError(`Could not read the registry: ${e.shortMessage || e.message}`); }
    finally { setLoading(false); }
  }, [wallet.address, wallet.publicClient, wallet.config]);

  useEffect(() => { refresh(); }, [refresh]);

  const requiredComplete = useMemo(() => Boolean(
    form.name.trim() && form.category.trim() && form.city.trim() && form.country.trim() && form.regNumber.trim()
      && Number(form.yearsOperating) > 0 && Number(form.requested) > 0 && form.useOfFunds.trim()
      && Number(form.maturityMonths) > 0 && Number(form.revenue) > 0
      && documents.registration && documents.statements
  ), [form, documents]);

  const submitApplication = async () => {
    if (!requiredComplete) { setError("Complete the company, financial, funding and required-document fields before submitting."); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!chainRegistered) {
        await registryActions.registerBusiness(wallet.walletClient, wallet.publicClient, wallet.config.businessRegistry, {
          name: form.name.trim(), category: form.category.trim(), city: form.city.trim(), country: form.country.trim(),
          regNumberHash: keccak256(toBytes(form.regNumber.trim().toUpperCase())),
        });
        setChainRegistered(true);
      }
      const manifest = [];
      for (const [kind, file] of Object.entries(documents)) {
        if (file) manifest.push({ kind, name: file.name, type: file.type, size: file.size, hash: await hashFile(file) });
      }
      const timestamp = Date.now();
      const message = `Update Transcend application for ${wallet.address} at ${timestamp}`;
      const signature = await wallet.walletClient.signMessage({ account: wallet.address, message });
      await api.submitApplication(wallet.address, {
        address: wallet.address, message, signature, legalName: form.name.trim(), sector: form.category.trim(),
        city: form.city.trim(), country: form.country.trim(), yearsOperating: Number(form.yearsOperating),
        employees: Number(form.employees || 0), requestedUSDC: toUSDCUnits(form.requested).toString(),
        useOfFunds: form.useOfFunds.trim(), maturityMonths: Number(form.maturityMonths),
        reportedRevenueUSDC: toUSDCUnits(form.revenue).toString(),
        reportedGrossProfitUSDC: toUSDCUnits(form.grossProfit || "0").toString(),
        reportedEbitdaUSDC: toUSDCUnits(form.ebitda || "0").toString(),
        existingDebtUSDC: toUSDCUnits(form.debt || "0").toString(), documents: manifest,
      });
      setApplication({ status: "submitted", requested_usdc: toUSDCUnits(form.requested).toString() });
      setNotice("Application submitted. Your evidence fingerprints and underwriting request are recorded.");
      await new Promise((resolve) => setTimeout(resolve, 3200));
      await refresh();
    } catch (e) {
      const message = e.shortMessage || e.message || String(e);
      setError(/AlreadyRegistered/i.test(message)
        ? "This wallet is already registered onchain. Refreshing its indexed profile now; do not submit it twice."
        : message);
      if (/AlreadyRegistered/i.test(message)) await refresh();
    } finally { setBusy(false); }
  };

  if (!wallet.address) return <EmptyState title="Connect your business wallet" text="Applications are tied to the company wallet that will receive and repay funding." />;
  if (loading) return <EmptyState title="Checking the Arc registry" text="Confirming this wallet onchain before showing any registration action…" />;
  const approved = Boolean(business?.verified && business?.underwriting?.decision === 2 && business?.underwriting?.valid_until * 1000 >= Date.now());

  return <main className="page-shell pb-20 pt-10">
    <div className="page-kicker">Business issuer portal</div>
    <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-title">From application to investable business.</h1><p className="page-subtitle">Submit operating evidence once. Independent underwriters turn it into a comparable, investor-ready company profile.</p></div>{business && <StatusPill business={business} application={application} approved={approved}/>}</div>
    {notice && <div className="notice notice-ok">{notice}</div>}{error && <div className="notice notice-risk">{error}</div>}
    {((!business && !application) || editingApplication || (chainRegistered && !application && !business?.verified && !business?.syncing)) ? <ApplicationForm step={step} setStep={setStep} form={form} setForm={setForm} documents={documents} setDocuments={setDocuments} busy={busy} complete={requiredComplete} onSubmit={submitApplication}/>
      : application && !approved ? <ApplicationProgress application={application} business={business} onEdit={() => { setEditingApplication(true); setStep(1); }}/>
      : business?.syncing ? <section className="surface mt-8 p-7"><div className="section-label">Registered onchain</div><h2 className="section-title">Your registry record is safe. The market index is catching up.</h2><p className="section-copy">There is no need to register again. Keep the backend running and refresh in a few seconds.</p><button className="button-secondary mt-5" onClick={refresh}>Check again</button></section>
      : approved ? <ApprovedBusiness business={business} wallet={wallet} dealForm={dealForm} setDealForm={setDealForm} onOpenDeal={onOpenDeal} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} refresh={refresh}/>
      : <ApplicationProgress application={application || { status: business?.verified ? "underwriting" : "submitted" }} business={business} onEdit={() => { setEditingApplication(true); setStep(1); }}/>}</main>;
}

function ApplicationForm({ step, setStep, form, setForm, documents, setDocuments, busy, complete, onSubmit }) {
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return <section className="application-layout mt-8"><aside className="application-rail"><div className="section-label light">Application</div>{[[1,"Company"],[2,"Financial health"],[3,"Funding request"],[4,"Evidence"]].map(([n,label]) => <button key={n} className={step === n ? "active" : ""} onClick={() => setStep(n)}><b>0{n}</b><span>{label}</span></button>)}<p>Raw records stay private. Investors see the normalized underwriting output and its onchain hash.</p></aside><div className="surface application-form p-6 sm:p-8">
    {step === 1 && <><FormHeading kicker="Company identity" title="Tell us what the business actually does." text="This creates the public identity that underwriters verify against registration and ownership records."/><div className="form-grid"><Field label="Legal business name" value={form.name} onChange={(v) => update("name",v)}/><Field label="Sector" value={form.category} onChange={(v) => update("category",v)} placeholder="Retail, logistics, food processing…"/><Field label="City" value={form.city} onChange={(v) => update("city",v)}/><Field label="Country" value={form.country} onChange={(v) => update("country",v)}/><Field label="Registration number" value={form.regNumber} onChange={(v) => update("regNumber",v)}/><Field label="Years operating" value={form.yearsOperating} onChange={(v) => update("yearsOperating",v)} type="number"/><Field label="Employees" value={form.employees} onChange={(v) => update("employees",v)} type="number"/></div></>}
    {step === 2 && <><FormHeading kicker="Reported financials" title="Give the underwriter a starting point." text="These are management figures, not yet verified. Bank, POS, invoice and supplier records will be used to reconcile them."/><div className="form-grid"><MoneyField label="Trailing 12-month revenue" value={form.revenue} onChange={(v) => update("revenue",v)}/><MoneyField label="Gross profit" value={form.grossProfit} onChange={(v) => update("grossProfit",v)}/><MoneyField label="EBITDA" value={form.ebitda} onChange={(v) => update("ebitda",v)}/><MoneyField label="Existing business debt" value={form.debt} onChange={(v) => update("debt",v)}/></div><div className="explain-card mt-5"><strong>Why this is not accepted at face value</strong><p>Bank inflows can include transfers and loans. Underwriters reconcile them to sales records before publishing verified revenue or profit.</p></div></>}
    {step === 3 && <><FormHeading kicker="Funding request" title="Define the capital need and repayment horizon." text="Approved requests become milestone releases and a capped share of independently verified collections."/><div className="form-grid"><MoneyField label="Funding requested" value={form.requested} onChange={(v) => update("requested",v)}/><Field label="Target maturity (months)" value={form.maturityMonths} onChange={(v) => update("maturityMonths",v)} type="number"/><label className="field sm:col-span-2"><span>Specific use of funds</span><textarea rows="5" value={form.useOfFunds} onChange={(e) => update("useOfFunds",e.target.value)} placeholder="e.g. Purchase 400 cartons directly from two named suppliers; expected inventory cycle 45 days."/></label></div></>}
    {step === 4 && <><FormHeading kicker="Private evidence room" title="Upload the records used to prove the business." text="This prototype commits document fingerprints, names and coverage. Production uses encrypted storage with time-limited underwriter access."/><div className="document-grid"><FileField label="Registration and ownership" required file={documents.registration} onChange={(file) => setDocuments({...documents,registration:file})}/><FileField label="6–12 months bank statements" required file={documents.statements} onChange={(file) => setDocuments({...documents,statements:file})}/><FileField label="POS, invoices or inventory records" file={documents.records} onChange={(file) => setDocuments({...documents,records:file})}/></div><label className="consent-row"><input type="checkbox" defaultChecked/><span><strong>I authorize independent underwriting review</strong><small>Records are used to verify financial claims, ownership, debt and use of funds.</small></span></label></>}
    <div className="form-actions"><button className="button-secondary" disabled={step === 1} onClick={() => setStep((s) => Math.max(1,s-1))}>Back</button>{step < 4 ? <button className="button-primary" onClick={() => setStep((s) => Math.min(4,s+1))}>Continue</button> : <div className="submit-wrap"><span>{complete ? "Ready for wallet signature" : "Required fields or documents are missing"}</span><button className="button-primary" disabled={busy || !complete} onClick={onSubmit}>{busy ? "Submitting…" : "Submit for underwriting"}</button></div>}</div></div></section>;
}

function ApplicationProgress({ application, business, onEdit }) {
  const active = application?.status === "submitted" ? 1 : 3;
  const stages = ["submitted","document review","site verification","financial analysis","investment committee"];
  return <section className="surface mt-8 overflow-hidden"><div className="application-status-head"><div><div className="section-label light">Underwriting in progress</div><h2>{business?.business_name || application?.legal_name || "Your business"}</h2><p>Your business stays private until evidence and financial assessment are approved.</p></div><span>Application received</span></div><div className="application-timeline">{stages.map((label,index) => <div key={label} className={index <= active ? "done" : ""}><b>{index < active ? "✓" : index+1}</b><span>{label}</span></div>)}</div><div className="p-6"><h3 className="font-display text-xl font-semibold">What happens next</h3><div className="next-grid mt-4"><MiniInfo title="Statement reconciliation" text="Reported revenue is matched to bank, POS and invoice evidence."/><MiniInfo title="Local verification" text="An assigned underwriter confirms operations, ownership and inventory."/><MiniInfo title="Public investment profile" text="Only the approved normalized report and evidence commitments reach the market."/></div><button className="button-quiet mt-4" onClick={onEdit}>Update application evidence</button></div></section>;
}

function ApprovedBusiness({ business, wallet, dealForm, setDealForm, onOpenDeal, busy, setBusy, setError, setNotice, refresh }) {
  const report = business.underwriting;
  const updateMilestone = (index, field, value) => setDealForm((f) => ({...f,milestones:f.milestones.map((m,i) => i===index ? {...m,[field]:value}:m)}));
  const createDeal = async () => { setBusy(true); setError(null); try { const targetAmount=toUSDCUnits(dealForm.targetAmount); const milestoneAmounts=dealForm.milestones.map((m)=>toUSDCUnits(m.amount)); if(milestoneAmounts.reduce((a,b)=>a+b,0n)!==targetAmount) throw new Error("Milestones must sum exactly to the funding target."); await poolActions.createDeal(wallet.walletClient,wallet.publicClient,wallet.config.investmentPool,wallet.config.usdc,{targetAmount,collateralBps:Number(dealForm.collateralBps),profitShareBps:Number(dealForm.profitShareBps),repaymentIntervalSeconds:Number(dealForm.repaymentDays)*86400,numRepayments:Number(dealForm.numRepayments),milestoneDescriptions:dealForm.milestones.map((m)=>m.description),milestoneAmounts,milestonePayees:dealForm.milestones.map((m)=>m.payee||zeroAddress),repaymentCapUSDC:toUSDCUnits(dealForm.repaymentCap||"0")}); setNotice("Funding round created onchain. The market index will show it shortly."); setTimeout(refresh,3500); } catch(e){setError(e.shortMessage||e.message);} finally{setBusy(false);} };
  return <><section className="issuer-health mt-8"><div><div className="section-label light">Market approved</div><h2>{business.business_name}</h2><p>Independently underwritten by {report.underwriter_name || "the Transcend underwriting network"}</p></div><div className="grade-orb"><strong>{riskGradeLabel(report.risk_grade)}</strong><span>risk grade</span></div><div className="issuer-metrics"><MiniMetric label="Verified revenue" value={`$${formatUSDC(report.verified_revenue_usdc)}`}/><MiniMetric label="EBITDA" value={`$${formatUSDC(report.ebitda_usdc)}`}/><MiniMetric label="Bank coverage" value={`${report.bank_coverage_bps/100}%`}/><MiniMetric label="Cash stability" value={`${report.cash_flow_stability_bps/100}%`}/></div></section>{business.deals?.length>0&&<section className="mt-8"><div className="section-label">Funding history</div><div className="mt-3 grid gap-2">{business.deals.map((d)=><button key={d.deal_id} className="surface p-4 text-left" onClick={()=>onOpenDeal(d.deal_id)}>Deal #{d.deal_id} · ${formatUSDC(d.raised_amount)} of ${formatUSDC(d.target_amount)} funded</button>)}</div></section>}<section className="surface mt-8 p-6"><FormHeading kicker="Open a funding round" title="Convert the approved ask into controlled milestones." text="The contract enforces collateral, evidence review and investor voting."/><div className="form-grid mt-5"><MoneyField label="Target amount" value={dealForm.targetAmount} onChange={(v)=>setDealForm({...dealForm,targetAmount:v})}/><Field label="Collateral (bps)" value={dealForm.collateralBps} onChange={(v)=>setDealForm({...dealForm,collateralBps:v})}/><Field label="Verified revenue share (bps)" value={dealForm.profitShareBps} onChange={(v)=>setDealForm({...dealForm,profitShareBps:v})}/><Field label="Reporting interval (days)" value={dealForm.repaymentDays} onChange={(v)=>setDealForm({...dealForm,repaymentDays:v})}/><Field label="Number of periods" value={dealForm.numRepayments} onChange={(v)=>setDealForm({...dealForm,numRepayments:v})}/><MoneyField label="Distribution cap" value={dealForm.repaymentCap} onChange={(v)=>setDealForm({...dealForm,repaymentCap:v})}/></div><div className="mt-5 space-y-2">{dealForm.milestones.map((m,index)=><div className="milestone-editor" key={index}><input placeholder="Milestone and evidence required" value={m.description} onChange={(e)=>updateMilestone(index,"description",e.target.value)}/><input placeholder="USDC" value={m.amount} onChange={(e)=>updateMilestone(index,"amount",e.target.value)}/><input placeholder="Verified payee address (optional)" value={m.payee} onChange={(e)=>updateMilestone(index,"payee",e.target.value)}/></div>)}</div><button className="button-secondary mt-3" onClick={()=>setDealForm((f)=>({...f,milestones:[...f.milestones,{description:"",amount:"",payee:""}]}))}>Add milestone</button><button className="button-primary mt-5 ml-2" disabled={busy} onClick={createDeal}>Create controlled round</button></section></>;
}

function StatusPill({ business, application, approved }) { const label=approved?"Market approved":business?.syncing?"Syncing onchain record":application?"In underwriting":"Registered"; return <span className={`status-pill ${approved?"ok":""}`}>{label}</span>; }
function FormHeading({ kicker,title,text }) { return <div><div className="section-label">{kicker}</div><h2 className="section-title">{title}</h2><p className="section-copy">{text}</p></div>; }
function Field({ label,value,onChange,placeholder,type="text" }) { return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)}/></label>; }
function MoneyField({ label,value,onChange }) { return <label className="field"><span>{label} <small>USDC equivalent</small></span><div className="money-input"><b>$</b><input inputMode="decimal" value={value} onChange={(e)=>onChange(e.target.value)}/></div></label>; }
function FileField({ label,required,file,onChange }) { return <label className={`file-field ${file?"ready":""}`}><input type="file" accept=".pdf,.csv,.xlsx,.xls,image/*" onChange={(e)=>onChange(e.target.files?.[0]||null)}/><span>{file?"✓":"+"}</span><strong>{label}{required?" *":""}</strong><small>{file?`${file.name} · ${Math.max(1,Math.round(file.size/1024))} KB`:"PDF, spreadsheet or image"}</small></label>; }
function EmptyState({ title,text }) { return <main className="page-shell py-24 text-center"><h1 className="font-display text-3xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-xl text-ink-soft">{text}</p></main>; }
function MiniInfo({ title,text }) { return <div><strong>{title}</strong><p>{text}</p></div>; }
function MiniMetric({ label,value }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
async function hashFile(file) { const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer()); return `0x${Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("")}`; }
