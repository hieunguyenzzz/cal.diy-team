import { DEFAULT_HOST_WEIGHT } from "./hostDefaults";

type WeightedHost = { isFixed: boolean; weight: number | null | undefined };

// getLuckyUser can't choose when every round-robin weight is 0 (it throws), so bookings would fail.
// A missing weight means the default, not 0. Callers pass collective hosts as fixed.
export function hasOnlyZeroWeightRoundRobinHosts({
  isRRWeightsEnabled,
  hosts,
}: {
  isRRWeightsEnabled: boolean;
  hosts: readonly WeightedHost[];
}): boolean {
  if (!isRRWeightsEnabled) return false;
  const roundRobinHosts = hosts.filter((host) => !host.isFixed);
  return (
    roundRobinHosts.length > 0 && roundRobinHosts.every((host) => (host.weight ?? DEFAULT_HOST_WEIGHT) === 0)
  );
}
