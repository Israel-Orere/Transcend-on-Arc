export function formatUSDC(raw) {
  const n = typeof raw === "bigint" ? raw : BigInt(raw || 0);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function toUSDCUnits(displayAmount) {
  const [whole, frac = ""] = String(displayAmount).split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracPadded || "0");
}

export function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const DEAL_STATUS = ["Raising", "Active", "Repaying", "Completed", "Defaulted", "Cancelled"];
export const MILESTONE_STATUS = ["Pending", "Release requested", "Verifier attested", "Released"];

export function dealStatusColor(status) {
  const name = typeof status === "number" ? DEAL_STATUS[status] : status;
  switch (name) {
    case "Raising":
      return "text-ink-soft bg-paper-dim";
    case "Active":
      return "text-ochre bg-[color-mix(in_srgb,var(--color-ochre)_18%,transparent)]";
    case "Repaying":
      return "text-verified bg-[color-mix(in_srgb,var(--color-verified)_16%,transparent)]";
    case "Completed":
      return "text-verified bg-[color-mix(in_srgb,var(--color-verified)_22%,transparent)]";
    case "Defaulted":
      return "text-risk bg-[color-mix(in_srgb,var(--color-risk)_18%,transparent)]";
    default:
      return "text-ink-soft bg-paper-dim";
  }
}
