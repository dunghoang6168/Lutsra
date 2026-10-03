export interface CrossfadeGains { outgoing: number; incoming: number; }

export function constantSumCrossfadeGains(fraction: number): CrossfadeGains {
  const progress = Math.max(0, Math.min(1, fraction));
  const outgoing = Math.cos(progress * Math.PI / 2);
  const incoming = Math.sin(progress * Math.PI / 2);
  const total = outgoing + incoming;
  return total > 0 ? { outgoing: outgoing / total, incoming: incoming / total } : { outgoing: 0, incoming: 1 };
}
