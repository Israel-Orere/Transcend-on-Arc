const express = require("express");
const db = require("../db");
const { requireWalletSignature } = require("../auth");

const router = express.Router();

router.get("/:address", (req, res) => {
  const row = db.prepare("SELECT * FROM profiles WHERE business_address = ?").get(req.params.address.toLowerCase());
  res.json(row || null);
});

// Body: { address, message, signature, pitch, description, photoUrls }
router.put("/:address", requireWalletSignature, (req, res) => {
  const { pitch, description, photoUrls } = req.body;
  const address = req.walletAddress;

  db.prepare(
    `INSERT INTO profiles (business_address, pitch, description, photo_urls, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(business_address) DO UPDATE SET
        pitch=excluded.pitch, description=excluded.description, photo_urls=excluded.photo_urls,
        updated_at=excluded.updated_at`
  ).run(address, pitch || "", description || "", JSON.stringify(photoUrls || []), Date.now());

  res.json({ ok: true });
});

module.exports = router;
