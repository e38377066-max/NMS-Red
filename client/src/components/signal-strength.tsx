import { cn } from "@/lib/utils";

interface SignalStrengthProps {
  dbm: number | null | undefined | string;
  className?: string;
}

export function SignalStrength({ dbm, className }: SignalStrengthProps) {
  if (!dbm) {
    return <span className="text-muted-foreground text-sm">--</span>;
  }

  const value = typeof dbm === 'string' ? parseInt(dbm, 10) : dbm;
  
  if (isNaN(value)) {
    return <span className="text-muted-foreground text-sm">--</span>;
  }

  let colorClass = "text-emerald-500";
  let label = "Excellent";

  if (value < -80) {
    colorClass = "text-red-500";
    label = "Poor";
  } else if (value < -70) {
    colorClass = "text-yellow-500";
    label = "Good";
  }

  return (
    <div className={cn("flex items-center gap-2 font-mono", className)}>
      <span className={cn("text-sm font-bold", colorClass)}>{value} dBm</span>
    </div>
  );
}
