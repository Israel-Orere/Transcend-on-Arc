const db = require("./db");
const { publicClient, BusinessRegistryABI, InvestmentPoolABI, loadDeploymentAddresses } = require("./chain");

const { businessRegistry: REGISTRY_ADDRESS, investmentPool: POOL_ADDRESS } = loadDeploymentAddresses();

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_MS || 3000);
const MAX_BLOCK_RANGE = 2000n; // chunk large backfills to stay under RPC log-range limits

// ---------- Upsert helpers (refetch full struct from chain, don't trust event args alone) ----------

async function upsertBusiness(address) {
  const b = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getBusiness",
    args: [address],
  });
  if (!b.registered) return;
  db.prepare(
    `INSERT INTO businesses (address, business_name, category, city, country, verified, frozen,
        completed_deals, defaulted_deals, total_raised_usdc, total_repaid_usdc,
        disbursed_traceable_usdc, disbursed_untraceable_usdc, updated_at)
     VALUES (@address, @business_name, @category, @city, @country, @verified, @frozen,
        @completed_deals, @defaulted_deals, @total_raised_usdc, @total_repaid_usdc,
        @disbursed_traceable_usdc, @disbursed_untraceable_usdc, @updated_at)
     ON CONFLICT(address) DO UPDATE SET
        business_name=excluded.business_name, category=excluded.category, city=excluded.city,
        country=excluded.country, verified=excluded.verified, frozen=excluded.frozen,
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
    frozen: b.frozen ? 1 : 0,
    completed_deals: Number(b.completedDeals),
    defaulted_deals: Number(b.defaultedDeals),
    total_raised_usdc: b.totalRaisedUSDC.toString(),
    total_repaid_usdc: b.totalRepaidUSDC.toString(),
    disbursed_traceable_usdc: b.disbursedToTraceablePayeeUSDC.toString(),
    disbursed_untraceable_usdc: b.disbursedToUntraceablePayeeUSDC.toString(),
    updated_at: Date.now(),
  });
}

async function upsertVerifier(address) {
  const v = await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: BusinessRegistryABI,
    functionName: "getVerifier",
    args: [address],
  });
  db.prepare(
    `INSERT INTO verifiers (address, name, active, attestations_given, attestations_linked_to_default, updated_at)
     VALUES (@address, @name, @active, @attestations_given, @attestations_linked_to_default, @updated_at)
     ON CONFLICT(address) DO UPDATE SET
        name=excluded.name, active=excluded.active, attestations_given=excluded.attestations_given,
        attestations_linked_to_default=excluded.attestations_linked_to_default, updated_at=excluded.updated_at`
  ).run({
    address: address.toLowerCase(),
    name: v.name,
    active: v.active ? 1 : 0,
    attestations_given: Number(v.attestationsGiven),
    attestations_linked_to_default: Number(v.attestationsLinkedToDefault),
    updated_at: Date.now(),
  });
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
        released_amount, repayments_made, num_repayments, created_at, raising_deadline, paused, tx_hash, updated_at)
     VALUES (@deal_id, @business_address, @target_amount, @raised_amount, @collateral_amount,
        @profit_share_bps, @repayment_cap_usdc, @total_remitted_usdc, @status, @current_milestone_index,
        @released_amount, @repayments_made, @num_repayments, @created_at, @raising_deadline, @paused, @tx_hash, @updated_at)
     ON CONFLICT(deal_id) DO UPDATE SET
        raised_amount=excluded.raised_amount, status=excluded.status,
        current_milestone_index=excluded.current_milestone_index, released_amount=excluded.released_amount,
        repayments_made=excluded.repayments_made, total_remitted_usdc=excluded.total_remitted_usdc,
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
    created_at: Number(d.createdAt),
    raising_deadline: Number(d.raisingDeadline),
    paused: d.paused ? 1 : 0,
    tx_hash: txHash || null,
    updated_at: Date.now(),
  });

  await upsertMilestones(dealId);
  await upsertBusiness(d.business);
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
      default:
        break;
    }
  }

  for (const addr of touchedBusinesses) await upsertBusiness(addr);
  for (const addr of touchedVerifiers) await upsertVerifier(addr);
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

module.exports = { startIndexer, pollOnce, upsertBusiness, upsertDeal, upsertVerifier };
