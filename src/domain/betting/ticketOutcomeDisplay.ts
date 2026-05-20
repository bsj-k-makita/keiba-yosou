export function ticketResultText(isHit: boolean, payout = 0): string {
  if (isHit && payout > 0) return "🎯 的中";
  if (isHit) return "🎯 的中";
  return "✕ 不的中";
}
