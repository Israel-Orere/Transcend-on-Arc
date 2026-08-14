const express = require("express");
const db = require("../db");

const router = express.Router();
const STATUS_NAMES = ["Raising", "Active", "Repaying", "Completed", "Defaulted", "Cancelled"];

function ratioBps(a, b) {
  const numerator = BigInt(a || 0);
  const denominator = BigInt(b || 0);
  return denominator > 0n ? Number((numerator * 10_000n) / denominator) : 0;
}

function shape(row) {
  const grossMarginBps = ratioBps(row.gross_profit_usdc, row.verified_revenue_usdc);
  const ebitdaMarginBps = ratioBps(row.ebitda_usdc, row.verified_revenue_usdc);
  const gradeBase = Math.max(30, 100 - Math.max(0, Number(row.risk_grade || 5) - 1) * 14);
  const quality = Math.round((Number(row.bank_coverage_bps || 0) + Number(row.cash_flow_stability_bps || 0)) / 1000);
  const marginBonus = Math.min(10, Math.max(0, Math.round(ebitdaMarginBps / 300)));
  return {
    ...row,
    status_name: row.status == null ? null : STATUS_NAMES[row.status],
    gross_margin_bps: grossMarginBps,
    ebitda_margin_bps: ebitdaMarginBps,
    health_score: Math.min(99, Math.round(gradeBase * 0.72 + quality + marginBonus)),
  };
}

function marketRows() {
  return db.prepare(
    `SELECT b.*, u.*,
       d.deal_id, d.target_amount, d.raised_amount, d.collateral_amount, d.profit_share_bps,
       d.repayments_made, d.num_repayments, d.repayment_interval_seconds, d.next_repayment_due,
       d.status, d.created_at AS deal_created_at
     FROM businesses b
     JOIN underwriting_reports u ON u.business_address = b.address
     LEFT JOIN deals d ON d.deal_id = (
       SELECT d2.deal_id FROM deals d2 WHERE d2.business_address = b.address
       ORDER BY d2.deal_id DESC LIMIT 1
     )
     WHERE b.verified = 1 AND b.frozen = 0 AND u.decision = 2 AND u.valid_until >= ?`
  ).all(Math.floor(Date.now() / 1000)).map(shape).sort((a, b) => b.health_score - a.health_score)
    .map((row, index) => ({ ...row, market_rank: index + 1 }));
}

router.get("/", (req, res) => res.json(marketRows()));

router.get("/overview", (req, res) => {
  const businesses = marketRows();
  const totalTarget = businesses.reduce((sum, b) => sum + BigInt(b.target_amount || 0), 0n);
  const totalRaised = businesses.reduce((sum, b) => sum + BigInt(b.raised_amount || 0), 0n);
  res.json({
    proven_businesses: businesses.length,
    live_opportunities: businesses.filter((b) => b.status_name === "Raising").length,
    total_target_usdc: totalTarget.toString(),
    total_raised_usdc: totalRaised.toString(),
    average_health_score: businesses.length
      ? Math.round(businesses.reduce((sum, b) => sum + b.health_score, 0) / businesses.length)
      : 0,
  });
});

module.exports = router;
