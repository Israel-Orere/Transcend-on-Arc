const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM businesses ORDER BY updated_at DESC").all();
  res.json(rows);
});

router.get("/:address", (req, res) => {
  const row = db.prepare("SELECT * FROM businesses WHERE address = ?").get(req.params.address.toLowerCase());
  if (!row) return res.status(404).json({ error: "Business not found" });
  const profile = db.prepare("SELECT * FROM profiles WHERE business_address = ?").get(row.address);
  const deals = db.prepare("SELECT * FROM deals WHERE business_address = ? ORDER BY deal_id DESC").all(row.address);
  res.json({ ...row, profile: profile || null, deals });
});

module.exports = router;
