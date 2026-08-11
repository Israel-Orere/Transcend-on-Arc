import { useState } from "react";
import { Header } from "./components/Header";
import { Marketplace } from "./components/Marketplace";
import { DealDetail } from "./components/DealDetail";
import { BusinessDashboard } from "./components/BusinessDashboard";
import { VerifierDashboard } from "./components/VerifierDashboard";
import { useWallet } from "./lib/useWallet";

export default function App() {
  const [tab, setTab] = useState("marketplace");
  const [openDealId, setOpenDealId] = useState(null);
  const wallet = useWallet();

  const openDeal = (id) => setOpenDealId(id);
  const backToMarketplace = () => setOpenDealId(null);

  return (
    <div className="min-h-screen">
      <Header
        tab={tab}
        setTab={(t) => {
          setTab(t);
          setOpenDealId(null);
        }}
        wallet={wallet}
      />

      {openDealId ? (
        <DealDetail dealId={openDealId} wallet={wallet} onBack={backToMarketplace} />
      ) : tab === "marketplace" ? (
        <Marketplace onOpenDeal={openDeal} />
      ) : tab === "business" ? (
        <BusinessDashboard wallet={wallet} onOpenDeal={openDeal} />
      ) : (
        <VerifierDashboard wallet={wallet} onOpenDeal={openDeal} />
      )}

      <footer className="mx-auto max-w-5xl px-5 py-10 text-center text-xs text-ink-soft">
        Built on Arc · Milestone escrow, independent verification, and collateral — not a promise, a mechanism.
      </footer>
    </div>
  );
}
