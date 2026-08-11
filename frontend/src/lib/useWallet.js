import { useCallback, useEffect, useState } from "react";
import { getWalletClient, getPublicClient, ensureCorrectChain, loadRuntimeConfig } from "./chain";

export function useWallet() {
  const [config, setConfig] = useState(null);
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accounts) => setAddress(accounts[0] || null);
    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    return () => window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  const connect = useCallback(async () => {
    if (!config) return;
    setConnecting(true);
    setError(null);
    try {
      if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or a similar wallet.");
      await ensureCorrectChain(config);
      const [acct] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAddress(acct);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setConnecting(false);
    }
  }, [config]);

  const disconnect = useCallback(() => setAddress(null), []);

  const walletClient = config && address ? getWalletClient(config) : null;
  const publicClient = config ? getPublicClient(config) : null;

  return { config, address, connecting, error, connect, disconnect, walletClient, publicClient };
}
