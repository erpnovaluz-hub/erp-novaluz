import { BADGE_CLASSES } from "@/lib/format";
import type { Option } from "@/lib/entities";

export default function Badge({ value, options }: { value: string | null; options?: Option[] }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const opt = options?.find((o) => o.value === value);
  const label = opt?.label ?? value;
  const color = opt?.color ?? "gray";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        BADGE_CLASSES[color] ?? BADGE_CLASSES.gray
      }`}
    >
      {label}
    </span>
  );
}
