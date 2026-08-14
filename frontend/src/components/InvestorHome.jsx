import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { DealCard } from "./DealCard";
import { formatUSDC, DEAL_STATUS } from "../lib/format";

export function InvestorHome({ wallet, onOpenDeal }) {
  const [portfolio, setPortfolio] = useState(null);
  const [deals, setDeals] = useState([]);
  const [businesses, setBusinesses] = useState({});
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.deals(statusFilter || undefined), api.businesses()])
      .then(([d, b]) => {
        setDeals(d);
        setBusinesses(Object.fromEntries(b.map((biz) => [biz.address, biz])));
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    if (!wallet.address) {
      setPortfolio(null);
      return;
    }
    api.investorPortfolio(wallet.address).then(setPortfolio).catch(() => setPortfolio(null));
  }, [wallet.address]);

  const needsAction = portfolio?.deals?.filter((d) => d.needs_my_approval) || [];

  return (
    <div className="page-shell py-10">
      <section className="investor-hero">
        <div className="page-kicker light">Controlled capital marketplace</div>
        <h1 className="mt-3">Back growth.<br/>Limit blind trust.</h1>
        <p>Fund verified African businesses through USDC escrow. Capital leaves in approved tranches and distributions are calculated from verifier-attested collections.</p>
        <div className="hero-chips"><span>10% minimum first-loss bond</span><span>3-investor activation</span><span>Accountable supplier references</span><span>Arc settlement</span></div>
      </section>

      {!wallet.address && (
        <div className="mt-6 rounded-xl border border-dashed border-ink/15 bg-white px-5 py-4 text-sm text-ink-soft">
          Connect a wallet to see your own investments here. You can still browse the marketplace below.
        </div>
      )}

      {wallet.address && (
        <section className="mt-6">
          <h2 className="font-display text-xl font-semibold">My investments</h2>
          {!portfolio ? (
            <p className="mt-2 text-sm text-ink-soft">Loading…</p>
          ) : portfolio.deals.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-ink/15 bg-white px-5 py-4 text-sm text-ink-soft">
              You haven't invested in anything yet — pick a deal below to get started.
            </p>
          ) : (
            <>
              {needsAction.length > 0 && (
                <div className="mt-3 rounded-xl border border-ochre/40 bg-ochre-soft/40 px-4 py-3 text-sm">
                  <strong>{needsAction.length}</strong> deal{needsAction.length > 1 ? "s" : ""} awaiting your
                  milestone approval vote.
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {portfolio.deals.map((d) => (
                  <button
                    key={d.deal_id}
                    onClick={() => onOpenDeal(d.deal_id)}
                    className="rounded-xl border border-ink/10 bg-white p-4 text-left shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold">{d.business_name || `Deal #${d.deal_id}`}</span>
                      {d.needs_my_approval && <span className="text-xs font-semibold text-ochre">Action needed</span>}
                    </div>
                    <div className="mt-1 font-mono text-sm text-ink-soft">
                      You invested ${formatUSDC(d.my_contribution)} · {d.status_name}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Browse deals</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {["", ...DEAL_STATUS].map((f) => (
            <button
              key={f || "all"}
              onClick={() => setStatusFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === f ? "bg-ink text-paper" : "bg-paper-dim text-ink-soft hover:text-ink"
              }`}
            >
              {f || "All"}
            </button>
          ))}
        </div>

        {loading && <div className="mt-4 text-ink-soft">Loading deals…</div>}
        {!loading && deals.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-ink/15 px-6 py-12 text-center text-ink-soft">
            No deals match this filter yet.
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {deals.map((deal) => (
            <DealCard key={deal.deal_id} deal={deal} business={businesses[deal.business_address]} onOpen={onOpenDeal} />
          ))}
        </div>
      </section>
    </div>
  );
}
