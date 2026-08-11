const express = require("express");
const db = require("../db");

const router = express.Router();

const STATUS_NAMES = ["Raising", "Active", "Repaying", "Completed", "Defaulted", "Cancelled"];

// Everything a given wallet has invested in, with deal context and what's
// currently owed to them -- the personalized "my investments" view.
router.get("/:address", (req, res) => {
  const address = req.params.address.toLowerCase();
  const investments = db
    .prepare(
      `SELECT deal_id, SUM(CAST(amount AS INTEGER)) as total
       FROM investments WHERE investor_address = ? GROUP BY deal_id`
    )
    .all(address);

  const deals = investments.map((inv) => {
    const deal = db.prepare("SELECT * FROM deals WHERE deal_id = ?").get(inv.deal_id);
    if (!deal) return null;
    const business = db.prepare("SELECT * FROM businesses WHERE address = ?").get(deal.business_address);
    const pendingMilestone = db
      .prepare(
        `SELECT * FROM milestones WHERE deal_id = ? AND milestone_index = ? LIMIT 1`
      )
      .get(deal.deal_id, deal.current_milestone_index);
    return {
      ...deal,
      status_name: STATUS_NAMES[deal.status],
      business_name: business?.business_name || null,
      my_contribution: String(inv.total),
      needs_my_approval: pendingMilestone ? pendingMilestone.status === 2 : false, // VerifierAttested
    };
  });

  res.json({ address, deals: deals.filter(Boolean) });
});

module.exports = router;
