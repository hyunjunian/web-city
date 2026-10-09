// Difficulty levels (Rush Hour).

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyParams {
  startingFunds: number;
  /** Multiplies every stage-limit population threshold. */
  stageLimitMult: number;
  /** Fraction added to positive demand (and removed from negative demand). */
  demandBoost: number;
  /** Multiplies all tax income. */
  taxIncomeMult: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { startingFunds: 500_000, stageLimitMult: 0.83, demandBoost: 0.06, taxIncomeMult: 1.2 },
  medium: { startingFunds: 200_000, stageLimitMult: 0.91, demandBoost: 0.03, taxIncomeMult: 1.1 },
  hard: { startingFunds: 100_000, stageLimitMult: 1.0, demandBoost: 0, taxIncomeMult: 1.0 },
};
