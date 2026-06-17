// Money amounts in this app are plain JavaScript numbers, which are binary
// floating-point and therefore drift under repeated addition (the classic
// 0.1 + 0.2 === 0.30000000000000004). These helpers keep money values clean by
// working at whole-cent precision. They are pure and have no side effects.

const CENTS_PER_UNIT = 100;

/**
 * Rounds a money amount to 2 decimal places, clearing binary floating-point
 * noise (e.g. 0.1 + 0.2 -> 0.3). Non-finite input returns 0.
 */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

/**
 * Sums money amounts without floating-point accumulation drift by adding them
 * in integer cents. Non-finite entries are skipped.
 */
export function sumMoney(amounts: number[]): number {
  const totalCents = amounts.reduce(
    (cents, amount) => (Number.isFinite(amount) ? cents + Math.round(amount * CENTS_PER_UNIT) : cents),
    0
  );
  return totalCents / CENTS_PER_UNIT;
}
