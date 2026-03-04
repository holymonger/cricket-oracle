export function oversToBalls(overs: string): number | null {
  const value = overs.trim();
  const match = value.match(/^(\d+)\.(\d)$/);

  if (!match) {
    return null;
  }

  const fullOvers = Number(match[1]);
  const ballsInOver = Number(match[2]);

  if (!Number.isInteger(fullOvers) || !Number.isInteger(ballsInOver)) {
    return null;
  }

  if (fullOvers < 0 || ballsInOver < 0 || ballsInOver > 5) {
    return null;
  }

  return fullOvers * 6 + ballsInOver;
}