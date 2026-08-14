const express = require("express");
const db = require("../db");

const router = express.Router();

// DealStatus enum order, mirrored from InvestmentPool.sol, for convenience filters
const STATUS_NAMES = ["Raising", "Active", "Repaying", "Completed", "Defaulted", "Cancelled"];

router.get("/", (req, res) => {
  let query = "SELECT * FROM deals";
  const params = [];
  if (req.query.status) {
    const idx = STATUS_NAMES.indexOf(req.query.status);
    if (idx === -1) return res.status(400).json({ error: `Unknown status. Use one of: ${STATUS_NAMES.join(", ")}` });
    query += " WHERE status = ?";
    params.push(idx);
  }
  query += " ORDER BY deal_id DESC";
  const rows = db.prepare(query).all(...params);
  res.json(rows.map((r) => ({ ...r, status_name: STATUS_NAMES[r.status] })));
});

router.get("/:id", (req, res) => {
  const deal = db.prepare("SELECT * FROM deals WHERE deal_id = ?").get(req.params.id);
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  const milestones = db
    .prepare("SELECT * FROM milestones WHERE deal_id = ? ORDER BY milestone_index ASC")
    .all(req.params.id);
  const investments = db
    .prepare("SELECT investor_address, SUM(CAST(amount AS INTEGER)) as total FROM investments WHERE deal_id = ? GROUP BY investor_address")
    .all(req.params.id);
  const business = db.prepare("SELECT * FROM businesses WHERE address = ?").get(deal.business_address);
  const profile = db.prepare("SELECT * FROM profiles WHERE business_address = ?").get(deal.business_address);
  const endorsements = db.prepare(
    `SELECT e.*, b.business_name AS supplier_name, b.category AS supplier_category,
        s.current_weight AS supplier_current_weight,
        s.endorsements_linked_to_default AS supplier_bad_references
     FROM supplier_endorsements e
     LEFT JOIN businesses b ON b.address = e.supplier_address
     LEFT JOIN supplier_reputations s ON s.address = e.supplier_address
     WHERE e.merchant_address = ? ORDER BY e.weight_at_issue DESC, e.issued_at DESC`
  ).all(deal.business_address);
  const revenueReports = db.prepare(
    "SELECT * FROM revenue_reports WHERE deal_id = ? ORDER BY period ASC"
  ).all(req.params.id);
  const underwriting = db.prepare(
    "SELECT * FROM underwriting_reports WHERE business_address = ?"
  ).get(deal.business_address);
  const application = db.prepare(
    `SELECT legal_name, sector, city, country, years_operating, employees, requested_usdc,
       use_of_funds, maturity_months, reported_revenue_usdc, reported_gross_profit_usdc,
       reported_ebitda_usdc, existing_debt_usdc, status
     FROM applications WHERE business_address = ?`
  ).get(deal.business_address);
  res.json({
    ...deal,
    status_name: STATUS_NAMES[deal.status],
    milestones,
    investments,
    business: business || null,
    profile: profile || null,
    endorsements,
    revenue_reports: revenueReports,
    underwriting: underwriting || null,
    application: application || null,
  });
});

router.get("/:id/milestones", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM milestones WHERE deal_id = ? ORDER BY milestone_index ASC")
    .all(req.params.id);
  res.json(rows);
});

module.exports = router;
