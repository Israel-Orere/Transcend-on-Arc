const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM verifiers ORDER BY attestations_given DESC").all();
  res.json(rows);
});

router.get("/:address", (req, res) => {
  const row = db.prepare("SELECT * FROM verifiers WHERE address = ?").get(req.params.address.toLowerCase());
  if (!row) return res.status(404).json({ error: "Verifier not found" });
  res.json(row);
});

module.exports = router;
