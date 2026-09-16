/** Balance is always visible in the header (plan section 13). */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-raised px-3.5">
      <span className="text-xs text-faint">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
    </span>
  );
}
