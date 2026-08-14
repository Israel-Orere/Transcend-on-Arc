import { formatUSDC, dealStatusColor, DEAL_STATUS, shortAddr } from "../lib/format";

export function DealCard({ deal, business, onOpen }) {
  const pct = deal.target_amount === "0" ? 0 : Math.round((Number(deal.raised_amount) / Number(deal.target_amount)) * 100);
  const statusName = deal.status_name || DEAL_STATUS[deal.status];

  return (
    <button
      onClick={() => onOpen(deal.deal_id)}
      className="stub-edge group relative w-full rounded-xl border border-ink/10 bg-white pl-6 pr-5 py-5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-semibold leading-tight">
            {business?.business_name || shortAddr(deal.business_address)}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">
            {business?.city ? `${business.city}, ${business.country}` : shortAddr(deal.business_address)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${dealStatusColor(statusName)}`}>
          {statusName}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-2xl font-semibold text-ink">${formatUSDC(deal.target_amount)}</div>
          <div className="text-xs text-ink-soft">raise target</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm text-ochre">{pct}%</div>
          <div className="text-xs text-ink-soft">funded</div>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper-dim">
        <div className="h-full rounded-full bg-ochre transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
        <span>Deal #{deal.deal_id}</span>
        <span className="font-mono">{deal.profit_share_bps / 100}% verified revenue share</span>
      </div>
    </button>
  );
}
