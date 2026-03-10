/**
 * Cursor encoding/decoding for file simulator
 * Cursor is encoded as a simple string index (0, 1, 2, ...)
 */

export function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const index = parseInt(cursor, 10);
  return isNaN(index) ? 0 : Math.max(0, index);
}

export function encodeCursor(index: number): string {
  return index.toString();
}
