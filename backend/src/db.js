// Uses Node's built-in SQLite (node:sqlite, stable since Node ~22.5) instead
// of better-sqlite3. better-sqlite3 is a native module that needs a C++
// compiler + Python to build on machines without a prebuilt binary for their
// Node version -- a real barrier for non-developer setups. node:sqlite ships
// inside Node itself, so `npm install` never needs to compile anything.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "transcend.db");

const rawDb = new DatabaseSync(DB_PATH);
rawDb.exec("PRAGMA journal_mode = WAL");

// Thin wrapper matching the subset of the better-sqlite3 API this codebase
// uses (db.exec, db.prepare().get/run/all, db.transaction), so nothing in
// indexer.js or routes/*.js has to change.
const db = {
  exec: (sql) => rawDb.exec(sql),
  prepare: (sql) => {
    const stmt = rawDb.prepare(sql);
    return {
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
      run: (...args) => stmt.run(...args),
    };
  },
  transaction: (fn) => {
    return (...args) => {
      rawDb.exec("BEGIN");
      try {
        const result = fn(...args);
        rawDb.exec("COMMIT");
        return result;
      } catch (err) {
        rawDb.exec("ROLLBACK");
        throw err;
      }
    };
  },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    address TEXT PRIMARY KEY,
    business_name TEXT,
    category TEXT,
    city TEXT,
    country TEXT,
    verified INTEGER DEFAULT 0,
    supplier_verified INTEGER DEFAULT 0,
    frozen INTEGER DEFAULT 0,
    completed_deals INTEGER DEFAULT 0,
    defaulted_deals INTEGER DEFAULT 0,
    total_raised_usdc TEXT DEFAULT '0',
    total_repaid_usdc TEXT DEFAULT '0',
    disbursed_traceable_usdc TEXT DEFAULT '0',
    disbursed_untraceable_usdc TEXT DEFAULT '0',
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS verifiers (
    address TEXT PRIMARY KEY,
    name TEXT,
    active INTEGER DEFAULT 1,
    attestations_given INTEGER DEFAULT 0,
    attestations_linked_to_default INTEGER DEFAULT 0,
    underwriting_reports_published INTEGER DEFAULT 0,
    underwritings_linked_to_default INTEGER DEFAULT 0,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS supplier_reputations (
    address TEXT PRIMARY KEY,
    endorsements_given INTEGER DEFAULT 0,
    endorsements_linked_to_default INTEGER DEFAULT 0,
    endorsements_revoked INTEGER DEFAULT 0,
    current_weight INTEGER DEFAULT 0,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS supplier_endorsements (
    merchant_address TEXT,
    supplier_address TEXT,
    relationship_hash TEXT,
    evidence_hash TEXT,
    relationship_months INTEGER,
    rating INTEGER,
    issued_at INTEGER,
    expires_at INTEGER,
    related_party INTEGER DEFAULT 0,
    revoked INTEGER DEFAULT 0,
    weight_at_issue INTEGER DEFAULT 0,
    updated_at INTEGER,
    PRIMARY KEY (merchant_address, supplier_address)
  );

  CREATE TABLE IF NOT EXISTS applications (
    business_address TEXT PRIMARY KEY,
    status TEXT DEFAULT 'draft',
    legal_name TEXT,
    sector TEXT,
    city TEXT,
    country TEXT,
    years_operating INTEGER DEFAULT 0,
    employees INTEGER DEFAULT 0,
    requested_usdc TEXT DEFAULT '0',
    use_of_funds TEXT,
    maturity_months INTEGER DEFAULT 0,
    reported_revenue_usdc TEXT DEFAULT '0',
    reported_gross_profit_usdc TEXT DEFAULT '0',
    reported_ebitda_usdc TEXT DEFAULT '0',
    existing_debt_usdc TEXT DEFAULT '0',
    document_manifest TEXT DEFAULT '[]',
    assigned_underwriter TEXT,
    submitted_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS underwriting_reports (
    business_address TEXT PRIMARY KEY,
    underwriter_address TEXT,
    underwriter_name TEXT,
    data_room_hash TEXT,
    report_hash TEXT,
    verified_revenue_usdc TEXT DEFAULT '0',
    gross_profit_usdc TEXT DEFAULT '0',
    ebitda_usdc TEXT DEFAULT '0',
    average_monthly_bank_inflows_usdc TEXT DEFAULT '0',
    existing_debt_usdc TEXT DEFAULT '0',
    bank_coverage_bps INTEGER DEFAULT 0,
    cash_flow_stability_bps INTEGER DEFAULT 0,
    statement_months INTEGER DEFAULT 0,
    risk_grade INTEGER DEFAULT 0,
    issued_at INTEGER,
    valid_until INTEGER,
    decision INTEGER DEFAULT 0,
    summary TEXT,
    strengths TEXT DEFAULT '[]',
    risks TEXT DEFAULT '[]',
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS deals (
    deal_id INTEGER PRIMARY KEY,
    business_address TEXT,
    target_amount TEXT,
    raised_amount TEXT,
    collateral_amount TEXT,
    profit_share_bps INTEGER,
    repayment_cap_usdc TEXT DEFAULT '0',
    total_remitted_usdc TEXT DEFAULT '0',
    status INTEGER DEFAULT 0,
    current_milestone_index INTEGER DEFAULT 0,
    released_amount TEXT DEFAULT '0',
    repayments_made INTEGER DEFAULT 0,
    num_repayments INTEGER DEFAULT 0,
    repayment_interval_seconds INTEGER DEFAULT 0,
    next_repayment_due INTEGER DEFAULT 0,
    created_at INTEGER,
    raising_deadline INTEGER,
    paused INTEGER DEFAULT 0,
    tx_hash TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS milestones (
    deal_id INTEGER,
    milestone_index INTEGER,
    description TEXT,
    amount TEXT,
    payee TEXT,
    payee_is_onchain_verified INTEGER DEFAULT 0,
    payee_confirmed INTEGER DEFAULT 0,
    status INTEGER DEFAULT 0,
    evidence_hash TEXT,
    verifier TEXT,
    verifier2 TEXT,
    approval_weight TEXT DEFAULT '0',
    updated_at INTEGER,
    PRIMARY KEY (deal_id, milestone_index)
  );

  CREATE TABLE IF NOT EXISTS investments (
    deal_id INTEGER,
    investor_address TEXT,
    amount TEXT,
    tx_hash TEXT,
    block_number INTEGER,
    created_at INTEGER,
    PRIMARY KEY (deal_id, investor_address, tx_hash)
  );

  CREATE TABLE IF NOT EXISTS revenue_reports (
    deal_id INTEGER,
    period INTEGER,
    gross_revenue_usdc TEXT,
    amount_due_usdc TEXT,
    evidence_hash TEXT,
    verifier TEXT,
    submitted_at INTEGER,
    attested INTEGER DEFAULT 0,
    settled INTEGER DEFAULT 0,
    updated_at INTEGER,
    PRIMARY KEY (deal_id, period)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    business_address TEXT PRIMARY KEY,
    pitch TEXT,
    description TEXT,
    photo_urls TEXT DEFAULT '[]',
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_block INTEGER DEFAULT 0
  );

  INSERT OR IGNORE INTO indexer_state (id, last_block) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS deployment_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fingerprint TEXT,
    updated_at INTEGER
  );
`);

// Lightweight forward migration for databases created before supplier
// credentials were separated from ordinary business verification.
try {
  rawDb.exec("ALTER TABLE businesses ADD COLUMN supplier_verified INTEGER DEFAULT 0");
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) throw err;
}

for (const migration of [
  "ALTER TABLE verifiers ADD COLUMN underwriting_reports_published INTEGER DEFAULT 0",
  "ALTER TABLE verifiers ADD COLUMN underwritings_linked_to_default INTEGER DEFAULT 0",
  "ALTER TABLE deals ADD COLUMN repayment_interval_seconds INTEGER DEFAULT 0",
  "ALTER TABLE deals ADD COLUMN next_repayment_due INTEGER DEFAULT 0",
]) {
  try { rawDb.exec(migration); }
  catch (err) { if (!String(err.message).includes("duplicate column name")) throw err; }
}

module.exports = db;
