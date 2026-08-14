import { createPublicClient, createWalletClient, custom, http, defineChain } from "viem";
import BusinessRegistryArtifact from "../abi/BusinessRegistry.json";
import InvestmentPoolArtifact from "../abi/InvestmentPool.json";

export const BusinessRegistryABI = BusinessRegistryArtifact.abi;
export const InvestmentPoolABI = InvestmentPoolArtifact.abi;

export const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:4000");

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
      chainId: Number(import.meta.env.VITE_CHAIN_ID || (import.meta.env.PROD ? 5042002 : 31337)),
      rpcUrl: import.meta.env.VITE_RPC_URL || (import.meta.env.PROD ? "https://rpc.testnet.arc.io" : "http://127.0.0.1:8545"),
      usdc: import.meta.env.VITE_USDC_ADDRESS || (import.meta.env.PROD ? "0x3600000000000000000000000000000000000000" : null),
      businessRegistry: import.meta.env.VITE_BUSINESS_REGISTRY_ADDRESS || null,
      investmentPool: import.meta.env.VITE_INVESTMENT_POOL_ADDRESS || null,
      deploymentReady: Boolean(import.meta.env.VITE_BUSINESS_REGISTRY_ADDRESS && import.meta.env.VITE_INVESTMENT_POOL_ADDRESS),
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

// When multiple wallet extensions are installed, window.ethereum can end up
// pointing at whichever one loaded last -- not necessarily MetaMask -- which
// looks exactly like "network not recognized" even after adding it correctly
// in MetaMask itself. Most wallets that support this expose every injected
// provider under window.ethereum.providers; prefer the one flagged
// isMetaMask, and fall back to window.ethereum itself if that array isn't
// present (single-wallet case).
export function getInjectedProvider() {
  if (!window.ethereum) return null;
  const providers = window.ethereum.providers;
  if (Array.isArray(providers) && providers.length > 0) {
    return providers.find((p) => p.isMetaMask) || providers[0];
  }
  return window.ethereum;
}

export function getWalletClient(config) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet found (install MetaMask or similar).");
  const chain = buildChain(config);
  return createWalletClient({ chain, transport: custom(provider) });
}

export async function ensureCorrectChain(config) {
  const provider = getInjectedProvider();
  if (!provider) return;
  const chain = buildChain(config);
  const hexChainId = "0x" + chain.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (err) {
    if (err.code === 4902) {
      await provider.request({
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
