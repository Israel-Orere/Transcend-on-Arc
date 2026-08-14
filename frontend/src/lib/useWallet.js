import { useCallback, useEffect, useState } from "react";
import { getWalletClient, getPublicClient, ensureCorrectChain, loadRuntimeConfig, getInjectedProvider } from "./chain";

export function useWallet() {
  const [config, setConfig] = useState(null);
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;
    const handleAccountsChanged = (accounts) => setAddress(accounts[0] || null);
    provider.on?.("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  const connect = useCallback(async () => {
    if (!config) return;
    setConnecting(true);
    setError(null);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No injected wallet found. Install MetaMask or a similar wallet.");
      // Request account access FIRST. Some wallets won't reliably surface the
      // "add network" approval popup for a site that doesn't have account
      // permission yet, which otherwise looks like the popup silently never
      // appeared.
      const [acct] = await provider.request({ method: "eth_requestAccounts" });
      await ensureCorrectChain(config);
      setAddress(acct);
    } catch (err) {
      if (err.code === 4902 || /Unrecognized chain/i.test(err.message || "")) {
        setError(
          `Your wallet doesn't recognize this network yet. Open MetaMask, click the network dropdown, ` +
            `"Add a custom network", and enter Chain ID ${config.chainId}, RPC URL ${config.rpcUrl}, ` +
            `Currency symbol USDC -- then try connecting again.`
        );
      } else {
        setError(err.message || String(err));
      }
    } finally {
      setConnecting(false);
    }
  }, [config]);

  const disconnect = useCallback(() => setAddress(null), []);

  const walletClient = config && address ? getWalletClient(config) : null;
  const publicClient = config ? getPublicClient(config) : null;

  return { config, address, connecting, error, connect, disconnect, walletClient, publicClient };
}
