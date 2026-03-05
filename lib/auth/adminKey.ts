/**
 * Admin key authentication utilities.
 */

export class MissingAdminKeyConfigError extends Error {
  constructor() {
    super(
      "Server misconfiguration: ADMIN_KEY environment variable is not set. Please set ADMIN_KEY in .env.local and Vercel environment variables."
    );
    this.name = "MissingAdminKeyConfigError";
  }
}

export class UnauthorizedAdminKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedAdminKeyError";
  }
}

export function getAdminKeyFromRequest(req: Request): string | null {
  return req.headers.get("x-admin-key");
}

/**
 * Verify admin key from request headers
 * Returns true if key is valid, false otherwise (does not throw)
 */
export function verifyAdminKey(key: string | null): boolean {
  const expectedKey = process.env.ADMIN_KEY;

  if (!expectedKey) {
    console.error("Server misconfiguration: ADMIN_KEY environment variable is not set");
    return false;
  }

  if (!key) {
    return false;
  }

  return key === expectedKey;
}

export function assertAdminKey(req: Request): void {
  const providedKey = getAdminKeyFromRequest(req);
  const expectedKey = process.env.ADMIN_KEY;

  if (!expectedKey) {
    throw new MissingAdminKeyConfigError();
  }

  if (!providedKey) {
    throw new UnauthorizedAdminKeyError("Unauthorized: Missing x-admin-key header");
  }

  if (providedKey !== expectedKey) {
    throw new UnauthorizedAdminKeyError("Unauthorized: Invalid admin key");
  }
}
