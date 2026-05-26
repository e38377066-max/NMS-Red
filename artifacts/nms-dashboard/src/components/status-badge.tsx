import { cn } from "@/lib/utils";
import { EquipmentLastSeenStatus } from "@workspace/api-client-react";

interface StatusBadgeProps {
  status: EquipmentLastSeenStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (status === EquipmentLastSeenStatus.ONLINE) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span className="text-xs font-medium text-emerald-500 tracking-wider">ONLINE</span>
      </div>
    );
  }

  if (status === EquipmentLastSeenStatus.OFFLINE) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-red-400"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
        </span>
        <span className="text-xs font-medium text-red-500 tracking-wider">OFFLINE</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500"></span>
      <span className="text-xs font-medium text-yellow-500 tracking-wider">UNKNOWN</span>
    </div>
  );
}
