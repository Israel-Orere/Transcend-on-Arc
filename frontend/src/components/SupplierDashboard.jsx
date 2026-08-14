import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, toBytes } from "viem";
import { api } from "../lib/api";
import { registryActions } from "../lib/contracts";
import { shortAddr } from "../lib/format";

export function SupplierDashboard({ wallet }) {
  const [businesses, setBusinesses] = useState([]);
  const [record, setRecord] = useState(null);
  const [merchant, setMerchant] = useState("");
  const [months, setMonths] = useState("12");
  const [rating, setRating] = useState("5");
  const [evidence, setEvidence] = useState("");
  const [relatedParty, setRelatedParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    const list = await api.businesses();
    setBusinesses(list.filter((b) => b.verified && !b.frozen));
    if (wallet.address) {
      const r = await api.supplierEndorsements(wallet.address).catch(() => null);
      setRecord(r);
    }
  }, [wallet.address]);

  useEffect(() => { refresh(); }, [refresh]);
  const selected = useMemo(() => businesses.find((b) => b.address === merchant), [businesses, merchant]);
  const ownBusiness = useMemo(
    () => businesses.find((b) => b.address === wallet.address?.toLowerCase()),
    [businesses, wallet.address]
  );

  const endorse = async () => {
    if (!wallet.address || !merchant || !evidence.trim()) {
      setMessage({ type: "error", text: "Connect a wallet, select a merchant and describe the evidence reviewed." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60);
      await registryActions.endorseMerchant(
        wallet.walletClient,
        wallet.publicClient,
        wallet.config.businessRegistry,
        {
          merchant,
          relationshipHash: keccak256(toBytes(`${wallet.address}:${merchant}:${months}`)),
          evidenceHash: keccak256(toBytes(evidence.trim())),
          relationshipMonths: Number(months),
          rating: Number(rating),
          expiresAt,
          relatedParty,
        }
      );
      setMessage({ type: "ok", text: "Commercial reference recorded on Arc. Your reputation is now attached to it." });
      setEvidence("");
      await new Promise((r) => setTimeout(r, 3500));
      await refresh();
    } catch (e) {
      setMessage({ type: "error", text: e.shortMessage || e.message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (merchantAddress) => {
    setBusy(true);
    try {
      await registryActions.revokeSupplierEndorsement(
        wallet.walletClient,
        wallet.publicClient,
        wallet.config.businessRegistry,
        merchantAddress
      );
      setMessage({ type: "ok", text: "Endorsement revoked. The revocation remains visible in your history." });
      await new Promise((r) => setTimeout(r, 3500));
      await refresh();
    } catch (e) {
      setMessage({ type: "error", text: e.shortMessage || e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!wallet.address) return <Empty text="Connect the verified business wallet used by your supplier company." />;

  return (
    <main className="page-shell pb-20 pt-10">
      <div className="page-kicker">Accountable references</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Supplier reputation desk</h1>
          <p className="page-subtitle">Endorse trading partners with evidence, not anonymous likes.</p>
        </div>
        <div className="trust-orb">
          <strong>{record?.reputation?.current_weight ?? "—"}</strong>
          <span>current weight</span>
        </div>
      </div>

      {message && <div className={`notice ${message.type === "error" ? "notice-risk" : "notice-ok"}`}>{message.text}</div>}
      {!ownBusiness?.supplier_verified && <div className="notice notice-risk">This wallet does not yet have the verified-supplier credential. A platform reviewer must confirm the company’s supplier activity before it can issue weighted references.</div>}

      <section className="surface mt-8 grid gap-8 p-6 lg:grid-cols-[1.2fr_.8fr]">
        <div>
          <div className="section-label">Issue a commercial reference</div>
          <h2 className="section-title">Put your own track record behind a merchant</h2>
          <p className="section-copy">
            Only verified suppliers can endorse. References expire after six months, reused evidence is rejected, and a
            future merchant default reduces the supplier’s own endorsement weight.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="field sm:col-span-2">
              <span>Merchant</span>
              <select value={merchant} onChange={(e) => setMerchant(e.target.value)}>
                <option value="">Select a verified merchant</option>
                {businesses.filter((b) => b.address !== wallet.address?.toLowerCase()).map((b) => (
                  <option key={b.address} value={b.address}>{b.business_name} · {b.city}</option>
                ))}
              </select>
            </label>
            <label className="field"><span>Relationship length</span><select value={months} onChange={(e) => setMonths(e.target.value)}><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">24+ months</option></select></label>
            <label className="field"><span>Trading experience</span><select value={rating} onChange={(e) => setRating(e.target.value)}><option value="5">5 · Excellent</option><option value="4">4 · Reliable</option><option value="3">3 · Acceptable</option><option value="2">2 · Concerns</option><option value="1">1 · Poor</option></select></label>
            <label className="field sm:col-span-2"><span>Evidence description</span><textarea rows="4" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Describe invoice periods, fulfilment history and the private evidence reviewed. Only a hash is stored onchain." /></label>
            <label className="check-row sm:col-span-2"><input type="checkbox" checked={relatedParty} onChange={(e) => setRelatedParty(e.target.checked)} /><span><strong>Related-party relationship</strong><small>Disclosed references remain visible but contribute zero trust weight.</small></span></label>
          </div>
          <button className="button-primary mt-5" disabled={busy || !selected || !ownBusiness?.supplier_verified} onClick={endorse}>{busy ? "Confirming on Arc…" : "Sign accountable endorsement"}</button>
        </div>
        <div className="control-panel">
          <div className="section-label">Your accountability</div>
          <div className="control-number-grid mt-4">
            <Metric value={record?.reputation?.endorsements_given || 0} label="References issued" />
            <Metric value={record?.reputation?.endorsements_linked_to_default || 0} label="Linked defaults" tone="risk" />
            <Metric value={record?.reputation?.endorsements_revoked || 0} label="Revocations" />
          </div>
          <div className="control-rule mt-5"><span>01</span><p>Evidence hashes prevent one invoice bundle from supporting multiple references.</p></div>
          <div className="control-rule"><span>02</span><p>Relationship disclosure separates independent commercial proof from family or common ownership.</p></div>
          <div className="control-rule"><span>03</span><p>Bad endorsements reduce future influence, creating a reason to reference carefully.</p></div>
        </div>
      </section>

      <section className="mt-10">
        <div className="section-label">Reference history</div>
        <h2 className="section-title">Every endorsement remains auditable</h2>
        <div className="mt-4 grid gap-3">
          {(record?.endorsements || []).length === 0 ? <Empty text="No supplier endorsements issued from this wallet yet." compact /> : record.endorsements.map((e) => (
            <article className="endorsement-row" key={e.merchant_address}>
              <div><strong>{e.merchant_name || shortAddr(e.merchant_address)}</strong><span>{e.relationship_months} month relationship · {e.rating}/5 rating</span></div>
              <div className="endorsement-tags">{e.related_party ? <span className="tag tag-warn">Related party · zero weight</span> : <span className="tag tag-ok">Independent</span>}{e.revoked ? <span className="tag tag-risk">Revoked</span> : <span className="tag">Weight {e.weight_at_issue}</span>}</div>
              {!e.revoked && <button className="button-quiet" disabled={busy} onClick={() => revoke(e.merchant_address)}>Revoke</button>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ value, label, tone }) { return <div className={`control-metric ${tone === "risk" ? "risk" : ""}`}><strong>{value}</strong><span>{label}</span></div>; }
function Empty({ text, compact }) { return <div className={`${compact ? "py-8" : "page-shell py-24"} text-center text-ink-soft`}>{text}</div>; }
