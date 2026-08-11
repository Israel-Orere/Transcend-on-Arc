export function Stamp({ label = "verified", color = "verified", size = "md" }) {
  const colorVar = { verified: "var(--color-verified)", ochre: "var(--color-ochre)", risk: "var(--color-risk)" }[
    color
  ];
  const sizing = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-3 py-1";
  return (
    <span className={`stamp stamp-in ${sizing} font-semibold`} style={{ color: colorVar }}>
      {label}
    </span>
  );
}
