/**
 * Admin key authentication utilities for write operations.
 * Provides header-based validation of admin key.
 */

export function getAdminKeyFromRequest(req: Request): string | null {
  return req.headers.get('x-admin-key');
}

export function assertAdminKey(req: Request): void {
  const providedKey = getAdminKeyFromRequest(req);
  const expectedKey = process.env.ADMIN_KEY;

  if (!expectedKey) {
    throw new Error(
      'Server misconfiguration: ADMIN_KEY environment variable is not set. ' +
      'Please set ADMIN_KEY in .env.local and Vercel environment variables.'
    );
  }

  if (!providedKey) {
    throw new Error('Unauthorized: Missing x-admin-key header');
  }

  if (providedKey !== expectedKey) {
    throw new Error('Unauthorized: Invalid admin key');
  }
}
