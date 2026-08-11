import { createPublicClient, createWalletClient, custom, http, defineChain } from "viem";
import BusinessRegistryArtifact from "../abi/BusinessRegistry.json";
import InvestmentPoolArtifact from "../abi/InvestmentPool.json";

export const BusinessRegistryABI = BusinessRegistryArtifact.abi;
export const InvestmentPoolABI = InvestmentPoolArtifact.abi;

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// Fetched once at app start from the backend's /config, which knows the
// live deployment addresses (local seed file or Arc Testnet env vars).
// Falls back to VITE_* env vars if the backend is unreachable.
let cachedConfig = null;

export async function loadRuntimeConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) throw new Error("config fetch failed");
    cachedConfig = await res.json();
  } catch {
    cachedConfig = {
      chainId: Number(import.meta.env.VITE_CHAIN_ID || 31337),
      rpcUrl: import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545",
      usdc: import.meta.env.VITE_USDC_ADDRESS || null,
      businessRegistry: import.meta.env.VITE_BUSINESS_REGISTRY_ADDRESS || null,
      investmentPool: import.meta.env.VITE_INVESTMENT_POOL_ADDRESS || null,
    };
  }
  return cachedConfig;
}

export function buildChain(config) {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 5042002 ? "Arc Testnet" : "Local Dev Chain",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers:
      config.chainId === 5042002 ? { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } } : undefined,
  });
}

export function getPublicClient(config) {
  const chain = buildChain(config);
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

export function getWalletClient(config) {
  if (!window.ethereum) throw new Error("No injected wallet found (install MetaMask or similar).");
  const chain = buildChain(config);
  return createWalletClient({ chain, transport: custom(window.ethereum) });
}

export async function ensureCorrectChain(config) {
  if (!window.ethereum) return;
  const chain = buildChain(config);
  const hexChainId = "0x" + chain.id.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      });
    } else {
      throw err;
    }
  }
}
