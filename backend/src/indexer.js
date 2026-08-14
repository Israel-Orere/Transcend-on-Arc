const db = require("./db");
const { publicClient, BusinessRegistryABI, InvestmentPoolABI, loadDeploymentAddresses } = require("./chain");

const { businessRegistry: REGISTRY_ADDRESS, investmentPool: POOL_ADDRESS } = loadDeploymentAddresses();

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_MS || 3000);
const MAX_BLOCK_RANGE = 2000n; // chunk large backfills to stay under RPC log-range limits
const DEPLOYMENT_BLOCK = Math.max(0, Number(process.env.DEPLOYMENT_BLOCK || 0));

async function ensureDeploymentState() {
  const [chainId, genesis] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlock({ blockNumber: 0n }),
  ]);
  const fingerprint = `${chainId}:${genesis.hash}:${REGISTRY_ADDRESS.toLowerCase()}:${POOL_ADDRESS.toLowerCase()}`;
  const current = db.prepare("SELECT fingerprint FROM deployment_state WHERE id = 1").get();
  if (current?.fingerprint === fingerprint) return;

  // Contract addresses are deterministic on a fresh Hardhat chain, so address
  // comparison alone cannot detect a restart. Reset only indexed/public data;
  // private applications and profiles survive the local chain reset.
  db.transaction(() => {
    for (const table of [
      "businesses", "verifiers", "supplier_reputations", "supplier_endorsements",
      "underwriting_reports", "deals", "milestones", "investments", "revenue_reports",
    ]) db.prepare(`DELETE FROM ${table}`).run();
    db.prepare("UPDATE indexer_state SET last_block = ? WHERE id = 1").run(Math.max(0, DEPLOYMENT_BLOCK - 1));
    db.prepare(
      `INSERT INTO deployment_state (id, fingerprint, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint, updated_at=excluded.updated_at`
    ).run(fingerprint, Date.now());
  })();
  console.log("Indexer detected a new deployment; rebuilt the on-chain cache.");
}

// ---------- Upsert helpers (refetch full struct from chain, don't trust event args alone) ----------

async function upsertBusiness(address) {
  const [b, supplierVerified] = await Promise.all([
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: BusinessRegistryABI,
      functionName: "getBusiness",
      args: [address],
    }),
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: BusinessRegistryABI,
      functionName: "isVerifiedSupplier",
      args: [address],
    }),
  ]);
  if (!b.registered) return;
  db.prepare(
    `INSERT INTO businesses (address, business_name, category, city, country, verified, supplier_verified, frozen,
        completed_deals, defaulted_deals, total_raised_usdc, total_repaid_usdc,
        disbursed_traceable_usdc, disbursed_untraceable_usdc, updated_at)
     VALUES (@address, @business_name, @category, @city, @country, @verified, @supplier_verified, @frozen,
        @completed_deals, @defaulted_deals, @total_raised_usdc, @total_repaid_usdc,
        @disbursed_traceable_usdc, @disbursed_untraceable_usdc, @updated_at)
     ON CONFLICT(address) DO UPDATE SET
        business_name=excluded.business_name, category=excluded.category, city=excluded.city,
        country=excluded.country, verified=excluded.verified, supplier_verified=excluded.supplier_verified, frozen=excluded.frozen,
        completed_deals=excluded.completed_deals, defaulted_deals=excluded.defaulted_deals,
        total_raised_usdc=excluded.total_raised_usdc, total_repaid_usdc=excluded.total_repaid_usdc,
        disbursed_traceable_usdc=excluded.disbursed_traceable_usdc,
        disbursed_untraceable_usdc=excluded.disbursed_untraceable_usdc, updated_at=excluded.updated_at`
  ).run({
    address: address.toLowerCase(),
    business_name: b.businessName,
    category: b.category,
    city: b.city,
    country: b.country,
    verified: b.verified ? 1 : 0,
    supplier_verified: supplierVerified ? 1 : 0,
    frozen: b.frozen ? 1 : 0,
    completed_deals: Number(b.completedDeals),
    defaulted_deals: Number(b.defaultedDeals),
    total_raised_usdc: b.totalRaisedUSDC.toString(),
    total_repaid_usdc: b.totalRepaidUSDC.toString(),
    disbursed_traceable_usdc: b.disbursedToTraceablePayeeUSDC.toString(),
    disbursed_untraceable_usdc: b.disbursedToUntraceablePayeeUSDC.toString(),
    updated_at: Date.now(),
  });
  await upsertUnderwritingReport(address);
}

async function upsertUnderwritingReport(address) {
  const report = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getUnderwritingReport",
    args: [address],
  });
  if (!report.underwriter || /^0x0{40}$/i.test(report.underwriter)) return;
  const verifier = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getVerifier",
    args: [report.underwriter],
  });
  db.prepare(
    `INSERT INTO underwriting_reports (business_address, underwriter_address, underwriter_name,
       data_room_hash, report_hash, verified_revenue_usdc, gross_profit_usdc, ebitda_usdc,
       average_monthly_bank_inflows_usdc, existing_debt_usdc, bank_coverage_bps,
       cash_flow_stability_bps, statement_months, risk_grade, issued_at, valid_until, decision, updated_at)
     VALUES (@business_address, @underwriter_address, @underwriter_name, @data_room_hash, @report_hash,
       @verified_revenue_usdc, @gross_profit_usdc, @ebitda_usdc, @average_monthly_bank_inflows_usdc,
       @existing_debt_usdc, @bank_coverage_bps, @cash_flow_stability_bps, @statement_months,
       @risk_grade, @issued_at, @valid_until, @decision, @updated_at)
     ON CONFLICT(business_address) DO UPDATE SET underwriter_address=excluded.underwriter_address,
       underwriter_name=excluded.underwriter_name, data_room_hash=excluded.data_room_hash,
       report_hash=excluded.report_hash, verified_revenue_usdc=excluded.verified_revenue_usdc,
       gross_profit_usdc=excluded.gross_profit_usdc, ebitda_usdc=excluded.ebitda_usdc,
       average_monthly_bank_inflows_usdc=excluded.average_monthly_bank_inflows_usdc,
       existing_debt_usdc=excluded.existing_debt_usdc, bank_coverage_bps=excluded.bank_coverage_bps,
       cash_flow_stability_bps=excluded.cash_flow_stability_bps, statement_months=excluded.statement_months,
       risk_grade=excluded.risk_grade, issued_at=excluded.issued_at, valid_until=excluded.valid_until,
       decision=excluded.decision, updated_at=excluded.updated_at`
  ).run({
    business_address: address.toLowerCase(),
    underwriter_address: report.underwriter.toLowerCase(),
    underwriter_name: verifier.name || "Independent underwriter",
    data_room_hash: report.dataRoomHash,
    report_hash: report.reportHash,
    verified_revenue_usdc: report.verifiedRevenueUSDC.toString(),
    gross_profit_usdc: report.grossProfitUSDC.toString(),
    ebitda_usdc: report.ebitdaUSDC.toString(),
    average_monthly_bank_inflows_usdc: report.averageMonthlyBankInflowsUSDC.toString(),
    existing_debt_usdc: report.existingDebtUSDC.toString(),
    bank_coverage_bps: Number(report.bankCoverageBps),
    cash_flow_stability_bps: Number(report.cashFlowStabilityBps),
    statement_months: Number(report.statementMonths),
    risk_grade: Number(report.riskGrade),
    issued_at: Number(report.issuedAt),
    valid_until: Number(report.validUntil),
    decision: Number(report.decision),
    updated_at: Date.now(),
  });
  const applicationStatus = Number(report.decision) === 2 ? "approved"
    : Number(report.decision) === 3 ? "watchlist" : "declined";
  db.prepare("UPDATE applications SET status = ?, assigned_underwriter = ?, updated_at = ? WHERE business_address = ?")
    .run(applicationStatus, report.underwriter.toLowerCase(), Date.now(), address.toLowerCase());
}

async function upsertVerifier(address) {
  const v = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getVerifier",
    args: [address],
  });
  db.prepare(
    `INSERT INTO verifiers (address, name, active, attestations_given, attestations_linked_to_default,
       underwriting_reports_published, underwritings_linked_to_default, updated_at)
     VALUES (@address, @name, @active, @attestations_given, @attestations_linked_to_default,
       @underwriting_reports_published, @underwritings_linked_to_default, @updated_at)
     ON CONFLICT(address) DO UPDATE SET
        name=excluded.name, active=excluded.active, attestations_given=excluded.attestations_given,
        attestations_linked_to_default=excluded.attestations_linked_to_default,
        underwriting_reports_published=excluded.underwriting_reports_published,
        underwritings_linked_to_default=excluded.underwritings_linked_to_default, updated_at=excluded.updated_at`
  ).run({
    address: address.toLowerCase(),
    name: v.name,
    active: v.active ? 1 : 0,
    attestations_given: Number(v.attestationsGiven),
    attestations_linked_to_default: Number(v.attestationsLinkedToDefault),
    underwriting_reports_published: Number(v.underwritingReportsPublished),
    underwritings_linked_to_default: Number(v.underwritingsLinkedToDefault),
    updated_at: Date.now(),
  });
}

async function upsertSupplierReputation(address) {
  const [s, weight] = await Promise.all([
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: BusinessRegistryABI,
      functionName: "getSupplierReputation",
      args: [address],
    }),
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: BusinessRegistryABI,
      functionName: "supplierReputationWeight",
      args: [address],
    }),
  ]);
  db.prepare(
    `INSERT INTO supplier_reputations (address, endorsements_given, endorsements_linked_to_default,
        endorsements_revoked, current_weight, updated_at)
     VALUES (@address, @endorsements_given, @endorsements_linked_to_default,
        @endorsements_revoked, @current_weight, @updated_at)
     ON CONFLICT(address) DO UPDATE SET endorsements_given=excluded.endorsements_given,
        endorsements_linked_to_default=excluded.endorsements_linked_to_default,
        endorsements_revoked=excluded.endorsements_revoked, current_weight=excluded.current_weight,
        updated_at=excluded.updated_at`
  ).run({
    address: address.toLowerCase(),
    endorsements_given: Number(s.endorsementsGiven),
    endorsements_linked_to_default: Number(s.endorsementsLinkedToDefault),
    endorsements_revoked: Number(s.endorsementsRevoked),
    current_weight: Number(weight),
    updated_at: Date.now(),
  });
}

async function upsertSupplierEndorsements(merchant) {
  const endorsements = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getSupplierEndorsements",
    args: [merchant],
  });
  const stmt = db.prepare(
    `INSERT INTO supplier_endorsements (merchant_address, supplier_address, relationship_hash, evidence_hash,
        relationship_months, rating, issued_at, expires_at, related_party, revoked, weight_at_issue, updated_at)
     VALUES (@merchant_address, @supplier_address, @relationship_hash, @evidence_hash,
        @relationship_months, @rating, @issued_at, @expires_at, @related_party, @revoked, @weight_at_issue, @updated_at)
     ON CONFLICT(merchant_address, supplier_address) DO UPDATE SET relationship_hash=excluded.relationship_hash,
        evidence_hash=excluded.evidence_hash, relationship_months=excluded.relationship_months,
        rating=excluded.rating, issued_at=excluded.issued_at, expires_at=excluded.expires_at,
        related_party=excluded.related_party, revoked=excluded.revoked,
        weight_at_issue=excluded.weight_at_issue, updated_at=excluded.updated_at`
  );
  for (const e of endorsements) {
    stmt.run({
      merchant_address: merchant.toLowerCase(),
      supplier_address: e.supplier.toLowerCase(),
      relationship_hash: e.relationshipHash,
      evidence_hash: e.evidenceHash,
      relationship_months: Number(e.relationshipMonths),
      rating: Number(e.rating),
      issued_at: Number(e.issuedAt),
      expires_at: Number(e.expiresAt),
      related_party: e.relatedParty ? 1 : 0,
      revoked: e.revoked ? 1 : 0,
      weight_at_issue: Number(e.weightAtIssue),
      updated_at: Date.now(),
    });
    await upsertSupplierReputation(e.supplier);
  }
}

async function upsertDeal(dealId, txHash) {
  const d = await publicClient.readContract({
    address: POOL_ADDRESS,
    abi: InvestmentPoolABI,
    functionName: "getDeal",
    args: [dealId],
  });
  db.prepare(
    `INSERT INTO deals (deal_id, business_address, target_amount, raised_amount, collateral_amount,
        profit_share_bps, repayment_cap_usdc, total_remitted_usdc, status, current_milestone_index,
        released_amount, repayments_made, num_repayments, repayment_interval_seconds, next_repayment_due,
        created_at, raising_deadline, paused, tx_hash, updated_at)
     VALUES (@deal_id, @business_address, @target_amount, @raised_amount, @collateral_amount,
        @profit_share_bps, @repayment_cap_usdc, @total_remitted_usdc, @status, @current_milestone_index,
        @released_amount, @repayments_made, @num_repayments, @repayment_interval_seconds, @next_repayment_due,
        @created_at, @raising_deadline, @paused, @tx_hash, @updated_at)
     ON CONFLICT(deal_id) DO UPDATE SET
        raised_amount=excluded.raised_amount, status=excluded.status,
        current_milestone_index=excluded.current_milestone_index, released_amount=excluded.released_amount,
        repayments_made=excluded.repayments_made, total_remitted_usdc=excluded.total_remitted_usdc,
        repayment_interval_seconds=excluded.repayment_interval_seconds, next_repayment_due=excluded.next_repayment_due,
        paused=excluded.paused, updated_at=excluded.updated_at`
  ).run({
    deal_id: Number(dealId),
    business_address: d.business.toLowerCase(),
    target_amount: d.targetAmount.toString(),
    raised_amount: d.raisedAmount.toString(),
    collateral_amount: d.collateralAmount.toString(),
    profit_share_bps: Number(d.profitShareBps),
    repayment_cap_usdc: d.repaymentCapUSDC.toString(),
    total_remitted_usdc: d.totalRemittedUSDC.toString(),
    status: Number(d.status),
    current_milestone_index: Number(d.currentMilestoneIndex),
    released_amount: d.releasedAmount.toString(),
    repayments_made: Number(d.repaymentsMade),
    num_repayments: Number(d.numRepayments),
    repayment_interval_seconds: Number(d.repaymentIntervalSeconds),
    next_repayment_due: Number(d.nextRepaymentDue),
    created_at: Number(d.createdAt),
    raising_deadline: Number(d.raisingDeadline),
    paused: d.paused ? 1 : 0,
    tx_hash: txHash || null,
    updated_at: Date.now(),
  });

  await upsertMilestones(dealId);
  await upsertRevenueReports(dealId, Number(d.repaymentsMade) + 1);
  await upsertBusiness(d.business);
}

async function upsertRevenueReports(dealId, throughPeriod) {
  const stmt = db.prepare(
    `INSERT INTO revenue_reports (deal_id, period, gross_revenue_usdc, amount_due_usdc, evidence_hash,
        verifier, submitted_at, attested, settled, updated_at)
     VALUES (@deal_id, @period, @gross_revenue_usdc, @amount_due_usdc, @evidence_hash,
        @verifier, @submitted_at, @attested, @settled, @updated_at)
     ON CONFLICT(deal_id, period) DO UPDATE SET gross_revenue_usdc=excluded.gross_revenue_usdc,
        amount_due_usdc=excluded.amount_due_usdc, evidence_hash=excluded.evidence_hash,
        verifier=excluded.verifier, submitted_at=excluded.submitted_at, attested=excluded.attested,
        settled=excluded.settled, updated_at=excluded.updated_at`
  );
  for (let period = 1; period <= throughPeriod; period++) {
    const report = await publicClient.readContract({
      address: POOL_ADDRESS,
      abi: InvestmentPoolABI,
      functionName: "getRevenueReport",
      args: [dealId, period],
    });
    if (Number(report.submittedAt) === 0) continue;
    stmt.run({
      deal_id: Number(dealId),
      period,
      gross_revenue_usdc: report.grossRevenueUSDC.toString(),
      amount_due_usdc: report.amountDueUSDC.toString(),
      evidence_hash: report.evidenceHash,
      verifier: report.verifier.toLowerCase(),
      submitted_at: Number(report.submittedAt),
      attested: report.attested ? 1 : 0,
      settled: report.settled ? 1 : 0,
      updated_at: Date.now(),
    });
  }
}

async function upsertMilestones(dealId) {
  const milestones = await publicClient.readContract({
    address: POOL_ADDRESS,
    abi: InvestmentPoolABI,
    functionName: "getMilestones",
    args: [dealId],
  });
  const stmt = db.prepare(
    `INSERT INTO milestones (deal_id, milestone_index, description, amount, payee, payee_is_onchain_verified,
        payee_confirmed, status, evidence_hash, verifier, verifier2, approval_weight, updated_at)
     VALUES (@deal_id, @milestone_index, @description, @amount, @payee, @payee_is_onchain_verified,
        @payee_confirmed, @status, @evidence_hash, @verifier, @verifier2, @approval_weight, @updated_at)
     ON CONFLICT(deal_id, milestone_index) DO UPDATE SET
        payee_confirmed=excluded.payee_confirmed, status=excluded.status, evidence_hash=excluded.evidence_hash,
        verifier=excluded.verifier, verifier2=excluded.verifier2, approval_weight=excluded.approval_weight,
        updated_at=excluded.updated_at`
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(
    milestones.map((m, idx) => ({
      deal_id: Number(dealId),
      milestone_index: idx,
      description: m.description,
      amount: m.amount.toString(),
      payee: m.payee.toLowerCase(),
      payee_is_onchain_verified: m.payeeIsOnChainVerified ? 1 : 0,
      payee_confirmed: m.payeeConfirmed ? 1 : 0,
      status: Number(m.status),
      evidence_hash: m.evidenceHash,
      verifier: m.verifier,
      verifier2: m.verifier2,
      approval_weight: m.approvalWeight.toString(),
      updated_at: Date.now(),
    }))
  );
}

function recordInvestment(dealId, investor, amount, txHash, blockNumber) {
  db.prepare(
    `INSERT OR IGNORE INTO investments (deal_id, investor_address, amount, tx_hash, block_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(Number(dealId), investor.toLowerCase(), amount.toString(), txHash, Number(blockNumber), Date.now());
}

// ---------- Poll loop ----------

async function processRegistryLogs(fromBlock, toBlock) {
  const logs = await publicClient.getLogs({ address: REGISTRY_ADDRESS, fromBlock, toBlock });
  const { decodeEventLog } = require("viem");
  const touchedBusinesses = new Set();
  const touchedVerifiers = new Set();
  const touchedMerchants = new Set();
  const touchedSuppliers = new Set();

  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: BusinessRegistryABI, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    switch (decoded.eventName) {
      case "BusinessRegistered":
      case "BusinessVerified":
      case "BusinessFrozen":
      case "BusinessUnfrozen":
      case "DealFundedRecorded":
      case "RepaymentRecorded":
      case "DealCompletedRecorded":
      case "DealDefaultedRecorded":
        touchedBusinesses.add(decoded.args.business);
        break;
      case "VerifierAdded":
      case "VerifierRemoved":
      case "VerifierAttestationRecorded":
      case "VerifierDefaultLinked":
        touchedVerifiers.add(decoded.args.verifier);
        break;
      case "SupplierEndorsed":
      case "SupplierEndorsementRevoked":
      case "SupplierEndorsementDefaultLinked":
        touchedMerchants.add(decoded.args.merchant);
        touchedSuppliers.add(decoded.args.supplier);
        break;
      case "SupplierStatusChanged":
        touchedBusinesses.add(decoded.args.supplier);
        touchedSuppliers.add(decoded.args.supplier);
        break;
      case "UnderwritingReportPublished":
        touchedBusinesses.add(decoded.args.business);
        touchedVerifiers.add(decoded.args.underwriter);
        break;
      default:
        break;
    }
  }

  for (const addr of touchedBusinesses) await upsertBusiness(addr);
  for (const addr of touchedVerifiers) await upsertVerifier(addr);
  for (const addr of touchedMerchants) await upsertSupplierEndorsements(addr);
  for (const addr of touchedSuppliers) await upsertSupplierReputation(addr);
}

async function processPoolLogs(fromBlock, toBlock) {
  const logs = await publicClient.getLogs({ address: POOL_ADDRESS, fromBlock, toBlock });
  const { decodeEventLog } = require("viem");
  const touchedDeals = new Map(); // dealId -> txHash

  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: InvestmentPoolABI, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const dealId = decoded.args.dealId;
    if (dealId !== undefined) {
      touchedDeals.set(dealId.toString(), log.transactionHash);
    }
    if (decoded.eventName === "Invested") {
      recordInvestment(dealId, decoded.args.investor, decoded.args.amount, log.transactionHash, log.blockNumber);
    }
  }

  for (const [dealId, txHash] of touchedDeals) {
    await upsertDeal(BigInt(dealId), txHash);
  }
}

async function pollOnce() {
  await ensureDeploymentState();
  const state = db.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get();
  const fromBlock = BigInt(state.last_block) + 1n;
  const latest = await publicClient.getBlockNumber();
  if (fromBlock > latest) return;

  let cursor = fromBlock;
  while (cursor <= latest) {
    const end = cursor + MAX_BLOCK_RANGE - 1n > latest ? latest : cursor + MAX_BLOCK_RANGE - 1n;
    await processRegistryLogs(cursor, end);
    await processPoolLogs(cursor, end);
    db.prepare("UPDATE indexer_state SET last_block = ? WHERE id = 1").run(Number(end));
    cursor = end + 1n;
  }
}

function startIndexer() {
  console.log(`Indexer watching registry=${REGISTRY_ADDRESS} pool=${POOL_ADDRESS}`);
  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error("Indexer poll error:", err.message);
    } finally {
      setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  tick();
}

module.exports = {
  startIndexer,
  pollOnce,
  upsertBusiness,
  upsertDeal,
  upsertVerifier,
  upsertSupplierReputation,
  upsertSupplierEndorsements,
  upsertUnderwritingReport,
  ensureDeploymentState,
};
