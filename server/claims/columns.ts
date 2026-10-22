// The claims board's stages are the claim pipeline (shared/claims-pipeline.ts).
// Kept as a thin module so existing imports keep working.
import { CLAIM_PIPELINE_STAGES, CLAIM_STAGE_KEYS } from '../../shared/claims-pipeline';

export const CLAIM_STAGES: readonly string[] = CLAIM_STAGE_KEYS;
export type ClaimStage = string;
export const CLAIM_COLUMNS = CLAIM_PIPELINE_STAGES;
