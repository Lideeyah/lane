/** Shared between the pairing API and the screens. */
export const PAIR_CODE_LENGTH = 6;
export const PAIR_TTL_SECONDS = 600;

export interface PairRecord {
  v: 1;
  t: `0x${string}`;
  n: string;
  s: string;
}

export function normaliseCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, PAIR_CODE_LENGTH);
}

/** "482 913" for display; the space is never part of the code. */
export function displayCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
