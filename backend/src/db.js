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
`);

module.exports = db;
