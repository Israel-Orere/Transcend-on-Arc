const express = require("express");
const db = require("../db");
const { requireWalletSignature } = require("../auth");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, b.business_name, b.verified, b.frozen
     FROM applications a LEFT JOIN businesses b ON b.address = a.business_address
     ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC`
  ).all();
  res.json(rows.map(parseApplication));
});

router.get("/:address", (req, res) => {
  const row = db.prepare("SELECT * FROM applications WHERE business_address = ?").get(req.params.address.toLowerCase());
  res.json(row ? parseApplication(row) : null);
});

router.put("/:address", requireWalletSignature, (req, res) => {
  const address = req.walletAddress;
  const {
    legalName, sector, city, country, yearsOperating, employees, requestedUSDC,
    useOfFunds, maturityMonths, reportedRevenueUSDC, reportedGrossProfitUSDC,
    reportedEbitdaUSDC, existingDebtUSDC, documents,
  } = req.body;
  if (!legalName || !sector || !city || !country || !useOfFunds || !Array.isArray(documents) || documents.length < 2) {
    return res.status(400).json({ error: "Complete the business, funding and document sections before submitting." });
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO applications (business_address, status, legal_name, sector, city, country,
       years_operating, employees, requested_usdc, use_of_funds, maturity_months,
       reported_revenue_usdc, reported_gross_profit_usdc, reported_ebitda_usdc,
       existing_debt_usdc, document_manifest, submitted_at, updated_at)
     VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_address) DO UPDATE SET status='submitted', legal_name=excluded.legal_name,
       sector=excluded.sector, city=excluded.city, country=excluded.country,
       years_operating=excluded.years_operating, employees=excluded.employees,
       requested_usdc=excluded.requested_usdc, use_of_funds=excluded.use_of_funds,
       maturity_months=excluded.maturity_months, reported_revenue_usdc=excluded.reported_revenue_usdc,
       reported_gross_profit_usdc=excluded.reported_gross_profit_usdc,
       reported_ebitda_usdc=excluded.reported_ebitda_usdc, existing_debt_usdc=excluded.existing_debt_usdc,
       document_manifest=excluded.document_manifest, submitted_at=excluded.submitted_at,
       updated_at=excluded.updated_at`
  ).run(
    address, legalName, sector, city, country, Number(yearsOperating || 0), Number(employees || 0),
    String(requestedUSDC || "0"), useOfFunds, Number(maturityMonths || 0), String(reportedRevenueUSDC || "0"),
    String(reportedGrossProfitUSDC || "0"), String(reportedEbitdaUSDC || "0"), String(existingDebtUSDC || "0"),
    JSON.stringify(documents), now, now
  );
  res.json({ ok: true, status: "submitted" });
});

function parseApplication(row) {
  return { ...row, documents: JSON.parse(row.document_manifest || "[]") };
}

module.exports = router;
