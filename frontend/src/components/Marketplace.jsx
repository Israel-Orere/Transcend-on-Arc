import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { DealCard } from "./DealCard";
import { DEAL_STATUS } from "../lib/format";

export function Marketplace({ onOpenDeal }) {
  const [deals, setDeals] = useState([]);
  const [businesses, setBusinesses] = useState({});
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.deals(statusFilter || undefined), api.businesses()])
      .then(([d, b]) => {
        setDeals(d);
        setBusinesses(Object.fromEntries(b.map((biz) => [biz.address, biz])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filters = useMemo(() => ["", ...DEAL_STATUS], []);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Verified capital for growing businesses
        </h1>
        <p className="mt-2 max-w-xl text-ink-soft">
          Every deal here releases in milestones, confirmed by an independent verifier — not a self-reported claim.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((f) => (
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

      {loading && <div className="text-ink-soft">Loading deals…</div>}
      {error && <div className="text-risk">{error}</div>}
      {!loading && !error && deals.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink/15 px-6 py-12 text-center text-ink-soft">
          No deals match this filter yet.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {deals.map((deal) => (
          <DealCard key={deal.deal_id} deal={deal} business={businesses[deal.business_address]} onOpen={onOpenDeal} />
        ))}
      </div>
    </div>
  );
}
