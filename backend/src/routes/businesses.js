const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare(
    `SELECT b.*, u.risk_grade, u.decision AS underwriting_decision, u.valid_until AS underwriting_valid_until,
       u.verified_revenue_usdc, u.ebitda_usdc, u.bank_coverage_bps, u.cash_flow_stability_bps
     FROM businesses b LEFT JOIN underwriting_reports u ON u.business_address = b.address
     ORDER BY b.updated_at DESC`
  ).all();
  res.json(rows);
});

router.get("/supplier/:address/endorsements", (req, res) => {
  const address = req.params.address.toLowerCase();
  const reputation = db.prepare("SELECT * FROM supplier_reputations WHERE address = ?").get(address) || null;
  const endorsements = db.prepare(
    `SELECT e.*, b.business_name AS merchant_name, b.city AS merchant_city,
        b.completed_deals AS merchant_completed_deals, b.defaulted_deals AS merchant_defaulted_deals
     FROM supplier_endorsements e
     LEFT JOIN businesses b ON b.address = e.merchant_address
     WHERE e.supplier_address = ? ORDER BY e.issued_at DESC`
  ).all(address);
  res.json({ reputation, endorsements });
});

router.get("/:address", (req, res) => {
  const row = db.prepare("SELECT * FROM businesses WHERE address = ?").get(req.params.address.toLowerCase());
  if (!row) return res.status(404).json({ error: "Business not found" });
  const profile = db.prepare("SELECT * FROM profiles WHERE business_address = ?").get(row.address);
  const underwriting = db.prepare("SELECT * FROM underwriting_reports WHERE business_address = ?").get(row.address);
  const application = db.prepare("SELECT * FROM applications WHERE business_address = ?").get(row.address);
  const deals = db.prepare("SELECT * FROM deals WHERE business_address = ? ORDER BY deal_id DESC").all(row.address);
  const endorsements = db.prepare(
    `SELECT e.*, b.business_name AS supplier_name, b.category AS supplier_category,
        s.current_weight AS supplier_current_weight,
        s.endorsements_linked_to_default AS supplier_bad_references
     FROM supplier_endorsements e
     LEFT JOIN businesses b ON b.address = e.supplier_address
     LEFT JOIN supplier_reputations s ON s.address = e.supplier_address
     WHERE e.merchant_address = ? ORDER BY e.weight_at_issue DESC, e.issued_at DESC`
  ).all(row.address);
  const endorsementScore = endorsements.reduce((sum, e) => {
    const active = !e.revoked && !e.related_party && e.expires_at * 1000 >= Date.now();
    return sum + (active ? Number(e.supplier_current_weight || e.weight_at_issue || 0) : 0);
  }, 0);
  res.json({
    ...row,
    profile: profile || null,
    underwriting: underwriting || null,
    application: application ? { ...application, document_manifest: undefined } : null,
    deals,
    endorsements,
    endorsement_score: endorsementScore,
  });
});

module.exports = router;
