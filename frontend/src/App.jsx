import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { RoleSelect } from "./components/RoleSelect";
import { InvestorHome } from "./components/InvestorHome";
import { DealDetail } from "./components/DealDetail";
import { BusinessDashboard } from "./components/BusinessDashboard";
import { UnderwriterDashboard } from "./components/UnderwriterDashboard";
import { SupplierDashboard } from "./components/SupplierDashboard";
import { ProtectionCenter } from "./components/ProtectionCenter";
import { useWallet } from "./lib/useWallet";

const ROLE_KEY = "transcend.role";

export default function App() {
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem(ROLE_KEY) || "investor";
    } catch {
      return "investor";
    }
  });
  const [openDealId, setOpenDealId] = useState(null);
  const [showProtection, setShowProtection] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    try {
      if (role) localStorage.setItem(ROLE_KEY, role);
      else localStorage.removeItem(ROLE_KEY);
    } catch {
      // ignore storage errors (e.g. private browsing)
    }
  }, [role]);

  const chooseRole = (r) => {
    setRole(r);
    setOpenDealId(null);
    setShowProtection(false);
  };
  const switchRole = () => {
    setRole(null);
    setOpenDealId(null);
    setShowProtection(false);
  };
  const goHome = () => { setOpenDealId(null); setShowProtection(false); };
  const openDeal = (id) => { setOpenDealId(id); setShowProtection(false); };

  return (
    <div className="min-h-screen">
      <Header role={role} onSwitchRole={switchRole} onGoHome={goHome} onProtection={() => setShowProtection(true)} wallet={wallet} />

      {showProtection ? (
        <ProtectionCenter onBrowse={() => { setShowProtection(false); if (!role) setRole("investor"); }} />
      ) : !role ? (
        <RoleSelect onSelect={chooseRole} />
      ) : openDealId ? (
        <DealDetail dealId={openDealId} wallet={wallet} onBack={() => setOpenDealId(null)} />
      ) : role === "investor" ? (
        <InvestorHome wallet={wallet} onOpenDeal={openDeal} />
      ) : role === "business" ? (
        <BusinessDashboard wallet={wallet} onOpenDeal={openDeal} />
      ) : role === "supplier" ? (
        <SupplierDashboard wallet={wallet} onOpenDeal={openDeal} />
      ) : (
        <UnderwriterDashboard wallet={wallet} />
      )}

      <footer className="mx-auto max-w-5xl px-5 py-10 text-center text-xs text-ink-soft">
        Built on Arc · USDC escrow, accountable attestations and verified-revenue distributions · Testnet prototype
      </footer>
    </div>
  );
}
