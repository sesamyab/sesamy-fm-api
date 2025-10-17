export interface JWTPayload {
  sub: string;
  scope?: string; // OAuth2 standard scope field (space-separated string)
  scopes?: string[]; // Legacy array format for backward compatibility
  permissions?: string[]; // Permissions array (e.g., ["podcast:read", "podcast:write"])
  org_id?: string; // Auth0 organization ID
  org_name?: string; // Auth0 organization name
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  [key: string]: any; // Allow custom claims like "https://sesamy.com/org_id"
}

// User type stored in context by hono-openapi-middlewares
export interface User extends JWTPayload {
  // The package stores the full JWT payload in ctx.get("user")
  // We can access standard and custom claims from here
}

export interface AuthContext {
  user: {
    id: string;
    scopes: string[];
    permissions: string[];
  };
}

// Define context variables that will be available via ctx.get() and ctx.set()
export interface ContextVariables {
  user: User; // User data from JWT token
  user_id: string; // User ID for backward compatibility
  jwtPayload?: JWTPayload; // Backward compatibility
  orgId?: string; // Backward compatibility
}

// Bindings for authentication and security
// Includes all requirements from both AuthenticationGenerics and RegisterComponentGenerics
export interface AppBindings {
  JWKS_URL: string;
  AUTH_URL: string;
  JWKS_SERVICE?: {
    fetch: typeof fetch;
  };
}

// Type for Hono context with our custom variables and bindings
export type AppContext = {
  Variables: ContextVariables;
  Bindings: AppBindings;
};
