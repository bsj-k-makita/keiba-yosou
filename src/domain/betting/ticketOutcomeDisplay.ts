import type { BetTicketType } from "./types";
import type { FormationHitMap } from "./markFormationHits";

export type TicketOutcomeFlags = {
  isHit: boolean;
  formationHit: boolean;
};

export function isTicketDisplayHit(flags: TicketOutcomeFlags): boolean {
  return flags.isHit || flags.formationHit;
}

export function formatTicketResultLabel(
  flags: TicketOutcomeFlags,
  payout = 0,
): "hit" | "formation" | "miss" {
  if (flags.isHit && payout > 0) return "hit";
  if (flags.isHit) return "hit";
  if (flags.formationHit) return "formation";
  return "miss";
}

export function ticketResultText(
  flags: TicketOutcomeFlags,
  payout = 0,
): string {
  const kind = formatTicketResultLabel(flags, payout);
  if (kind === "hit") return "🎯 的中";
  if (kind === "formation") return "印的中";
  return "✕ 不的中";
}

export function hasAnyTicketFormationHit(hits: FormationHitMap): boolean {
  return hits.WIN || hits.MAIN_LINE || hits.WIDE || hits.TRIFECTA_FORM;
}

export function formationHitForType(hits: FormationHitMap, type: BetTicketType): boolean {
  return hits[type];
}
