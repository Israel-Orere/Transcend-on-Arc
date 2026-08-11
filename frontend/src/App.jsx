import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { RoleSelect } from "./components/RoleSelect";
import { InvestorHome } from "./components/InvestorHome";
import { DealDetail } from "./components/DealDetail";
import { BusinessDashboard } from "./components/BusinessDashboard";
import { VerifierDashboard } from "./components/VerifierDashboard";
import { useWallet } from "./lib/useWallet";

const ROLE_KEY = "transcend.role";

export default function App() {
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem(ROLE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [openDealId, setOpenDealId] = useState(null);
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
  };
  const switchRole = () => {
    setRole(null);
    setOpenDealId(null);
  };
  const goHome = () => setOpenDealId(null);
  const openDeal = (id) => setOpenDealId(id);

  return (
    <div className="min-h-screen">
      <Header role={role} onSwitchRole={switchRole} onGoHome={goHome} wallet={wallet} />

      {!role ? (
        <RoleSelect onSelect={chooseRole} />
      ) : openDealId ? (
        <DealDetail dealId={openDealId} wallet={wallet} onBack={() => setOpenDealId(null)} />
      ) : role === "investor" ? (
        <InvestorHome wallet={wallet} onOpenDeal={openDeal} />
      ) : role === "business" ? (
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
