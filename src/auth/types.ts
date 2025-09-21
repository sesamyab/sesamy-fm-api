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
}

export interface AuthContext {
  user: {
    id: string;
    scopes: string[];
    permissions: string[];
  };
}
