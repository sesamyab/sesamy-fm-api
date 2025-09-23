import { createMiddleware } from "hono/factory";
import { decode, verify } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import { JWTPayload } from "./types";

// JWKS cache to avoid fetching keys on every request
let jwksCache: { keys: any[]; expires: number } | null = null;
const JWKS_URL = "https://token.sesamy.dev/.well-known/jwks.json";
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getJWKS(): Promise<any[]> {
  // Return cached keys if still valid
  if (jwksCache && Date.now() < jwksCache.expires) {
    return jwksCache.keys;
  }

  try {
    const response = await fetch(JWKS_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }

    const jwks = (await response.json()) as { keys?: any[] };
    const keys = jwks.keys || [];

    // Cache the keys
    jwksCache = {
      keys,
      expires: Date.now() + CACHE_DURATION,
    };

    return keys;
  } catch (error) {
    throw new Error("Unable to fetch JWT verification keys");
  }
}

async function getPublicKey(kid: string): Promise<string> {
  const keys = await getJWKS();
  const key = keys.find((k) => k.kid === kid);

  if (!key) {
    throw new Error(`Key with kid ${kid} not found in JWKS`);
  }

  // Convert JWK to PEM format for verification
  // For RSA keys (most common)
  if (key.kty === "RSA") {
    // For simplicity, we'll construct a basic PEM
    // In production, you might want to use a proper JWK to PEM converter
    return await jwkToPem(key);
  }

  throw new Error(`Unsupported key type: ${key.kty}`);
}

async function jwkToPem(jwk: any): Promise<string> {
  // For Cloudflare Workers, we'll use the Web Crypto API
  try {
    const keyData = {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg,
      use: jwk.use,
    };

    // Import the key using Web Crypto API
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      keyData,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      true,
      ["verify"]
    );

    // Export as SPKI format and convert to PEM
    const exported = (await crypto.subtle.exportKey(
      "spki",
      cryptoKey
    )) as ArrayBuffer;
    const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64
      .match(/.{1,64}/g)
      ?.join("\n")}\n-----END PUBLIC KEY-----`;

    return pem;
  } catch (error) {
    throw new Error("Failed to convert JWK to PEM format");
  }
}

/**
 * Basic JWT verification middleware - only validates JWT token
 * Used for endpoints that only need a valid user token (like organizations)
 */
export const jwtMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const problem = {
      type: "unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "Missing or invalid authorization header",
      instance: c.req.path,
    };
    throw new HTTPException(401, { message: JSON.stringify(problem) });
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    // First, decode the token to get the header (including kid)
    const { header } = decode(token);

    if (!header.kid) {
      throw new Error("Token missing key ID (kid)");
    }

    // Get the public key for verification
    const publicKey = await getPublicKey(header.kid);

    // Verify the token
    const payload = await verify(token, publicKey, header.alg || "RS256");

    // Set the payload in context for use by route handlers
    c.set("jwtPayload", payload);

    // Set organization ID if available
    if (payload.org_id) {
      c.set("orgId", payload.org_id);
    }

    await next();
  } catch (error: any) {
    const problem = {
      type: "unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "Invalid or expired token",
      instance: c.req.path,
    };
    throw new HTTPException(401, { message: JSON.stringify(problem) });
  }
});

/**
 * Full authentication middleware - validates JWT + requires organization context
 * Used for endpoints that need organization-scoped access
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  // First verify the JWT
  await jwtMiddleware(c, async () => {
    const payload = c.get("jwtPayload") as JWTPayload;

    // Check for organization context
    if (!payload.org_id) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Organization context required. Please select an organization.",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    await next();
  });
});

export const requireScopes = (requiredScopes: string[]) => {
  return createMiddleware(async (c, next) => {
    const payload = c.get("jwtPayload") as JWTPayload;

    if (!payload) {
      const problem = {
        type: "unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Missing or invalid authentication token",
        instance: c.req.path,
      };

      throw new HTTPException(401, {
        message: JSON.stringify(problem),
      });
    }

    // Extract scopes from either 'scope' (string) or 'scopes' (array) field
    let userScopes: string[] = [];
    if (payload.scope && typeof payload.scope === "string") {
      // OAuth2 standard: space-separated string
      userScopes = payload.scope.split(" ").filter((s) => s.length > 0);
    } else if (payload.scopes && Array.isArray(payload.scopes)) {
      // Legacy format: array of strings
      userScopes = payload.scopes;
    }

    const hasRequiredScope = requiredScopes.some((scope) =>
      userScopes.includes(scope)
    );

    if (!hasRequiredScope) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: `Required scopes: ${requiredScopes.join(
          ", "
        )}. User scopes: ${userScopes.join(", ")}`,
        instance: c.req.path,
      };

      throw new HTTPException(403, {
        message: JSON.stringify(problem),
      });
    }

    await next();
  });
};

/**
 * Middleware to require specific permissions from the JWT token
 */
export const requirePermissions = (requiredPermissions: string[]) => {
  return createMiddleware(async (c, next) => {
    const payload = c.get("jwtPayload") as JWTPayload;

    if (!payload) {
      const problem = {
        type: "unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Missing or invalid authentication token",
        instance: c.req.path,
      };

      throw new HTTPException(401, {
        message: JSON.stringify(problem),
      });
    }

    const userPermissions = payload.permissions || [];
    const hasRequiredPermission = requiredPermissions.some((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasRequiredPermission) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: `Required permissions: ${requiredPermissions.join(
          ", "
        )}. User permissions: ${userPermissions.join(", ")}`,
        instance: c.req.path,
      };

      throw new HTTPException(403, {
        message: JSON.stringify(problem),
      });
    }

    await next();
  });
};

/**
 * Helper function to check if user has required permissions (for inline use)
 */
export const hasPermissions = (
  payload: JWTPayload,
  requiredPermissions: string[]
): boolean => {
  const userPermissions = payload.permissions || [];
  return requiredPermissions.some((permission) =>
    userPermissions.includes(permission)
  );
};

/**
 * Middleware to require a specific organization context
 */
export const requireOrganization = () => {
  return createMiddleware(async (c, next) => {
    const payload = c.get("jwtPayload") as JWTPayload;

    if (!payload) {
      const problem = {
        type: "unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Missing or invalid authentication token",
        instance: c.req.path,
      };
      throw new HTTPException(401, { message: JSON.stringify(problem) });
    }

    if (!payload.org_id) {
      const problem = {
        type: "forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Organization context required. Please select an organization.",
        instance: c.req.path,
      };
      throw new HTTPException(403, { message: JSON.stringify(problem) });
    }

    await next();
  });
};

/**
 * Helper function to check if user has required scopes (for inline use)
 */
export const hasScopes = (
  payload: JWTPayload,
  requiredScopes: string[]
): boolean => {
  let userScopes: string[] = [];
  if (payload.scope && typeof payload.scope === "string") {
    userScopes = payload.scope.split(" ").filter((s) => s.length > 0);
  } else if (payload.scopes && Array.isArray(payload.scopes)) {
    userScopes = payload.scopes;
  }

  return requiredScopes.some((scope) => userScopes.includes(scope));
};

/**
 * Helper function to get organization ID from JWT payload
 */
export const getOrganizationId = (payload: JWTPayload): string | null => {
  return payload.org_id || null;
};

/**
 * Helper function to get organization ID from context variables
 * Uses any type to work around Hono's type constraints
 * Throws HTTPException if organization ID is not available
 */
export const getOrgIdFromContext = (c: any): string => {
  const orgId = (c as any).get("orgId");
  if (!orgId) {
    const problem = {
      type: "forbidden",
      title: "Forbidden",
      status: 403,
      detail: "Organization context required. Please select an organization.",
      instance: c.req.path,
    };
    throw new HTTPException(403, { message: JSON.stringify(problem) });
  }
  return orgId;
};
