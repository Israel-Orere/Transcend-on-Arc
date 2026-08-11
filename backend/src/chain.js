const fs = require("fs");
const path = require("path");
const { createPublicClient, http, defineChain } = require("viem");

const CONTRACTS_DIR = path.join(__dirname, "..", "..", "contracts");

function loadArtifact(contractName) {
  const artifactPath = path.join(
    CONTRACTS_DIR,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return raw.abi;
}

const BusinessRegistryABI = loadArtifact("BusinessRegistry");
const InvestmentPoolABI = loadArtifact("InvestmentPool");

// Local Hardhat network by default; point RPC_URL/CHAIN_ID at Arc Testnet for
// production (chainId 5042002, rpc.testnet.arc.io -- see docs.arc.io).
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 5042002 ? "Arc Testnet" : "Local Dev Chain",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

function loadDeploymentAddresses() {
  // Prefer explicit env vars (used for Arc Testnet); fall back to the local
  // seed script's output file for dev.
  if (process.env.BUSINESS_REGISTRY_ADDRESS && process.env.INVESTMENT_POOL_ADDRESS) {
    return {
      usdc: process.env.USDC_ADDRESS || null,
      businessRegistry: process.env.BUSINESS_REGISTRY_ADDRESS,
      investmentPool: process.env.INVESTMENT_POOL_ADDRESS,
    };
  }
  const localDeployPath = path.join(__dirname, "..", "deployment.local.json");
  if (fs.existsSync(localDeployPath)) {
    const d = JSON.parse(fs.readFileSync(localDeployPath, "utf8"));
    return { usdc: d.usdc, businessRegistry: d.businessRegistry, investmentPool: d.investmentPool };
  }
  throw new Error(
    "No contract addresses found. Set BUSINESS_REGISTRY_ADDRESS/INVESTMENT_POOL_ADDRESS env vars, " +
      "or run contracts/scripts/deploy-local.js to generate backend/deployment.local.json"
  );
}

module.exports = {
  publicClient,
  BusinessRegistryABI,
  InvestmentPoolABI,
  loadDeploymentAddresses,
  chain,
};
