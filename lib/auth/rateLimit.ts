const MAX_REQUESTS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const buckets = new Map<string, Bucket>();

export class RateLimitExceededError extends Error {
  constructor() {
    super("Rate limit exceeded: max 60 requests per minute per IP");
    this.name = "RateLimitExceededError";
  }
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return "unknown";
  }

  const firstIp = forwardedFor.split(",")[0]?.trim();
  return firstIp || "unknown";
}

export function rateLimitOrThrow(req: Request): void {
  const now = Date.now();
  const ip = getClientIp(req);
  const existingBucket = buckets.get(ip);

  const bucket: Bucket =
    existingBucket ?? {
      tokens: MAX_REQUESTS_PER_MINUTE,
      lastRefillMs: now,
    };

  const elapsedMs = now - bucket.lastRefillMs;
  const refillTokens = (elapsedMs / WINDOW_MS) * MAX_REQUESTS_PER_MINUTE;
  bucket.tokens = Math.min(MAX_REQUESTS_PER_MINUTE, bucket.tokens + refillTokens);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    buckets.set(ip, bucket);
    throw new RateLimitExceededError();
  }

  bucket.tokens -= 1;
  buckets.set(ip, bucket);
}
