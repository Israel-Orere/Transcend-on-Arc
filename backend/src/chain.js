const fs = require("fs");
const path = require("path");
const { createPublicClient, http, defineChain } = require("viem");

const CONTRACTS_DIR = path.join(__dirname, "..", "..", "contracts");

function loadArtifact(contractName) {
  // Compiled Hardhat artifacts are intentionally not committed. The frontend
  // ABI files are, so hosted functions can boot without compiling Solidity.
  const artifactPath = process.env.VERCEL
    ? path.join(CONTRACTS_DIR, "..", "frontend", "src", "abi", `${contractName}.json`)
    : path.join(CONTRACTS_DIR, "artifacts", "contracts", `${contractName}.sol`, `${contractName}.json`);
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return raw.abi;
}

const BusinessRegistryABI = loadArtifact("BusinessRegistry");
const InvestmentPoolABI = loadArtifact("InvestmentPool");

// Local Hardhat network by default; point RPC_URL/CHAIN_ID at Arc Testnet for
// production (chainId 5042002, rpc.testnet.arc.io -- see docs.arc.io).
const IS_HOSTED = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");
const RPC_URL = process.env.RPC_URL || (IS_HOSTED ? "https://rpc.testnet.arc.io" : "http://127.0.0.1:8545");
const CHAIN_ID = Number(process.env.CHAIN_ID || (IS_HOSTED ? 5042002 : 31337));

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 5042002 ? "Arc Testnet" : "Local Dev Chain",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

function loadDeploymentAddresses({ required = true } = {}) {
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
  if (!required) {
    return {
      usdc: process.env.USDC_ADDRESS || (CHAIN_ID === 5042002 ? "0x3600000000000000000000000000000000000000" : null),
      businessRegistry: null,
      investmentPool: null,
    };
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
