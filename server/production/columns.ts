// The production portion of BRN's JobTread "Status" pipeline (scheduling →
// complete), grouped into board columns. Sales/insurance stages that come
// before "Buyer Approved" and the "Lost" stage are intentionally excluded —
// they belong to the sales pipeline, not the production board.
export const PRODUCTION_COLUMNS = [
  { key: 'pre', label: 'Pre-Production', stages: ['Buyer Approved', 'Permitting'] },
  { key: 'scheduled', label: 'Scheduled', stages: ['Schedule'] },
  { key: 'in_production', label: 'In Production', stages: ['Pre-Construction', 'Roof Construction', 'Other Construction Work'] },
  { key: 'wrapping', label: 'Wrapping Up', stages: ['Complete', 'PIF File Warranties'] },
  { key: 'closed', label: 'Closed', stages: ['Closed'] },
] as const;

export type ProductionColumnKey = (typeof PRODUCTION_COLUMNS)[number]['key'];

const STAGE_TO_COLUMN: Record<string, ProductionColumnKey> = Object.fromEntries(
  PRODUCTION_COLUMNS.flatMap((c) => c.stages.map((s) => [s, c.key])),
) as Record<string, ProductionColumnKey>;

/** Every JobTread stage that belongs on the production board. */
export const PRODUCTION_STAGES: Set<string> = new Set(Object.keys(STAGE_TO_COLUMN));

/** The board column for a stage, or null if the stage isn't a production stage. */
export function columnForStage(stage: string | null | undefined): ProductionColumnKey | null {
  if (!stage) return null;
  return STAGE_TO_COLUMN[stage] ?? null;
}
