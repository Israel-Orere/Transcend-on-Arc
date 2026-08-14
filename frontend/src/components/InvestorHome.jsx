import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { formatCompactUSDC as compactUSDC, riskGradeLabel } from "../lib/format";

const WATCH_KEY = "transcend.watchlist";

export function InvestorHome({ wallet, onOpenDeal }) {
  const [market, setMarket] = useState([]);
  const [overview, setOverview] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All sectors");
  const [sort, setSort] = useState("Health score");
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    Promise.all([api.market(), api.marketOverview()])
      .then(([rows, stats]) => { setMarket(rows); setOverview(stats); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (wallet.address) api.investorPortfolio(wallet.address).then(setPortfolio).catch(() => setPortfolio(null));
    else setPortfolio(null);
  }, [wallet.address]);

  const sectors = useMemo(() => ["All sectors", ...new Set(market.map((b) => b.category).filter(Boolean))], [market]);
  const visible = useMemo(() => market.filter((b) => {
    const haystack = `${b.business_name} ${b.category} ${b.city} ${b.country}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (sector === "All sectors" || b.category === sector);
  }).sort((a, b) => sort === "Revenue" ? Number(b.verified_revenue_usdc) - Number(a.verified_revenue_usdc)
    : sort === "Funding progress" ? progress(b) - progress(a) : b.health_score - a.health_score), [market, query, sector, sort]);

  const toggleWatch = (address) => setWatchlist((current) => {
    const next = current.includes(address) ? current.filter((item) => item !== address) : [...current, address];
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* optional */ }
    return next;
  });

  return <main className="market-page pb-20">
    <section className="market-hero"><div className="page-shell market-hero-inner"><div><div className="market-eyebrow"><i/> TRANSCEND PRIVATE MARKET · ARC TESTNET</div><h1>Discover Africa’s<br/><em>proven businesses.</em></h1><p>Compare independently underwritten local companies, inspect verified financial health, and fund controlled revenue-share rounds onchain.</p><div className="market-actions"><a href="#market-board" className="button-lime">Explore the market</a><button className="market-link" onClick={() => document.getElementById("methodology")?.scrollIntoView({behavior:"smooth"})}>How verification works →</button></div></div><MarketPulse market={market}/></div></section>

    <section className="market-strip"><div className="page-shell market-stats"><MarketStat label="Approved businesses" value={overview?.proven_businesses ?? "—"}/><MarketStat label="Open rounds" value={overview?.live_opportunities ?? "—"}/><MarketStat label="Capital sought" value={overview ? `$${compactUSDC(overview.total_target_usdc)}` : "—"}/><MarketStat label="Average health" value={overview ? `${overview.average_health_score}/100` : "—"}/></div></section>

    <div className="page-shell">
      {portfolio?.deals?.length > 0 && <section className="portfolio-ribbon"><div><span>YOUR PORTFOLIO</span><strong>${compactUSDC(portfolio.total_invested || portfolio.deals.reduce((s,d)=>s+Number(d.my_contribution||0),0))} invested across {portfolio.deals.length} businesses</strong></div><div>{portfolio.deals.filter((d)=>d.needs_my_approval).length} actions pending</div></section>}

      <section id="market-board" className="market-board"><div className="market-board-head"><div><div className="page-kicker">The market board</div><h2>Ranked by verified financial health.</h2><p>Self-reported figures never determine ranking.</p></div><div className="market-tools"><input aria-label="Search companies" placeholder="Search company, city or sector" value={query} onChange={(e)=>setQuery(e.target.value)}/><select value={sector} onChange={(e)=>setSector(e.target.value)}>{sectors.map((s)=><option key={s}>{s}</option>)}</select><select value={sort} onChange={(e)=>setSort(e.target.value)}>{["Health score","Revenue","Funding progress"].map((s)=><option key={s}>{s}</option>)}</select></div></div>
      {loading ? <div className="market-empty">Loading the verified market…</div> : visible.length === 0 ? <div className="market-empty">{wallet.config?.deploymentReady ? "No approved Arc Testnet companies match this view." : "The Arc Testnet contracts are awaiting deployment. Listings will appear after businesses are underwritten onchain."}</div> : <div className="market-list">{visible.map((business)=><MarketRow key={business.address} business={business} watched={watchlist.includes(business.address)} onWatch={()=>toggleWatch(business.address)} onOpen={()=>business.deal_id != null && onOpenDeal(business.deal_id)}/>)}</div>}
      </section>

      <section id="methodology" className="market-method"><div><div className="page-kicker light">Market admission rule</div><h2>No verified P&amp;L,<br/>no listing.</h2><p>Transcend is closer to an underwritten private market than a public stock exchange. The round has a defined maturity and revenue-share cap; it is not freely tradable equity.</p></div><div className="method-steps">{[["01","Evidence","Bank statements, registration, invoices and operating records."],["02","Local review","Independent field and financial checks; related parties disclosed."],["03","Onchain report","Time-bound grade and normalized P&L committed to Arc."],["04","Controlled capital","Collateral, milestone escrow and investor release votes."]].map(([n,t,d])=><div key={n}><b>{n}</b><span><strong>{t}</strong><small>{d}</small></span></div>)}</div></section>
    </div>
  </main>;
}

function MarketRow({ business, watched, onWatch, onOpen }) {
  const pct = progress(business);
  const maturityMonths = business.repayment_interval_seconds && business.num_repayments
    ? Math.round(business.repayment_interval_seconds * business.num_repayments / 2_592_000) : null;
  return <article className="market-row"><div className="market-rank">#{String(business.market_rank).padStart(2,"0")}</div><div className="company-mark">{initials(business.business_name)}</div><div className="company-main"><div className="company-title"><h3>{business.business_name}</h3><span>{business.city}, {business.country}</span></div><div className="company-tags"><span>{business.category}</span><span>✓ {business.statement_months} months reviewed</span><span>Underwritten by {business.underwriter_name}</span></div></div><div className="health-cell"><span>HEALTH</span><strong>{business.health_score}</strong><i><em style={{width:`${business.health_score}%`}}/></i></div><div className="market-number"><span>VERIFIED REVENUE</span><strong>${compactUSDC(business.verified_revenue_usdc)}</strong><small>{(business.ebitda_margin_bps/100).toFixed(1)}% EBITDA margin</small></div><div className="market-number"><span>ROUND</span><strong>{business.target_amount ? `$${compactUSDC(business.target_amount)}` : "Not open"}</strong><small>{maturityMonths ? `${maturityMonths} month maturity` : "Terms pending"}</small></div><div className="funding-cell"><div><span>{pct}% funded</span><small>{business.profit_share_bps ? `${business.profit_share_bps/100}% verified revenue share` : "—"}</small></div><i><em style={{width:`${pct}%`}}/></i></div><div className={`grade-badge grade-${riskGradeLabel(business.risk_grade).toLowerCase()}`}><strong>{riskGradeLabel(business.risk_grade)}</strong><span>RISK</span></div><button className={`watch-button ${watched?"active":""}`} aria-label="Toggle watchlist" onClick={onWatch}>{watched?"★":"☆"}</button><button className="market-open" disabled={business.deal_id == null} onClick={onOpen}>View →</button></article>;
}

function MarketPulse({ market }) { return <div className="market-pulse"><div><span>MARKET SIGNAL</span><b>UNDERWRITTEN</b></div><div className="pulse-bars">{[42,58,51,68,62,76,71,85,82,94].map((v,i)=><i key={i} style={{height:`${v}%`}}/>)}</div><p><strong>{market[0]?.business_name || "Top companies"}</strong><span>{market.length ? `#1 health score · ${market[0].health_score}/100` : "Awaiting local market seed"}</span></p></div>; }
function MarketStat({label,value}) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function progress(b) { return Number(b.target_amount) ? Math.min(100, Math.round(Number(b.raised_amount || 0) / Number(b.target_amount) * 100)) : 0; }
function initials(name="Business") { return name.split(/\s+/).slice(0,2).map((p)=>p[0]).join("").toUpperCase(); }
