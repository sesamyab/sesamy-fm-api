import { eq } from "drizzle-orm";
import { Database } from "../database/client";
import {
  organizations,
  type Organization,
  type NewOrganization,
} from "../database/schema";
import { Auth0Service } from "../auth/auth0-service";
import { v4 as uuidv4 } from "uuid";

export class OrganizationService {
  constructor(
    private db: Database | undefined,
    private auth0Service?: Auth0Service
  ) {}

  /**
   * Get organization by ID
   */
  async getOrganization(id: string): Promise<Organization | null> {
    if (!this.db) {
      throw new Error("Database not available");
    }

    const result = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get organization by Auth0 org ID
   */
  async getOrganizationByAuth0Id(
    auth0OrgId: string
  ): Promise<Organization | null> {
    if (!this.db) {
      throw new Error("Database not available");
    }

    const result = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.auth0OrgId, auth0OrgId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get user's organizations from Auth0
   */
  async getUserOrganizations(
    userId: string
  ): Promise<{ id: string; name: string; auth0_id: string }[]> {
    if (!this.auth0Service) {
      throw new Error("Auth0 service not configured");
    }

    try {
      const auth0Orgs = await this.auth0Service.getUserOrganizations(userId);

      // Convert to the format expected by the client
      return auth0Orgs.map((org) => ({
        id: org.id,
        name: org.display_name || org.name,
        auth0_id: org.id,
      }));
    } catch (error) {
      console.error("Failed to get user organizations:", error);
      throw new Error("Failed to fetch user organizations");
    }
  }

  /**
   * Create a new organization both in Auth0 and locally
   */
  async createOrganization(
    name: string,
    userId: string,
    displayName?: string
  ): Promise<{ organization: Organization; auth0_org: any }> {
    if (!this.auth0Service) {
      throw new Error("Auth0 service not configured");
    }

    if (!this.db) {
      throw new Error("Database not available");
    }

    try {
      // Create organization in Auth0
      const auth0Org = await this.auth0Service.createOrganization(
        name,
        displayName
      );

      // Add user to the organization with admin role
      await this.auth0Service.addUserToOrganization(auth0Org.id, userId, [
        "podcasts:admin",
      ]);

      // Create organization in local database
      const newOrg: NewOrganization = {
        id: uuidv4(),
        name: auth0Org.display_name || auth0Org.name,
        auth0OrgId: auth0Org.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await this.db
        .insert(organizations)
        .values(newOrg)
        .returning();

      return {
        organization: result[0],
        auth0_org: auth0Org,
      };
    } catch (error) {
      console.error("Failed to create organization:", error);
      throw new Error("Failed to create organization");
    }
  }

  /**
   * Sync an Auth0 organization to local database if it doesn't exist
   */
  async syncOrganization(auth0OrgId: string): Promise<Organization> {
    // Check if organization already exists locally
    let org = await this.getOrganizationByAuth0Id(auth0OrgId);

    if (org) {
      return org;
    }

    if (!this.db) {
      throw new Error("Database not available");
    }

    if (!this.auth0Service) {
      throw new Error("Auth0 service not configured");
    }

    // Fetch from Auth0 and create locally
    const auth0Org = await this.auth0Service.getOrganization(auth0OrgId);
    if (!auth0Org) {
      throw new Error(`Organization ${auth0OrgId} not found in Auth0`);
    }

    const newOrg: NewOrganization = {
      id: uuidv4(),
      name: auth0Org.display_name || auth0Org.name,
      auth0OrgId: auth0Org.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await this.db
      .insert(organizations)
      .values(newOrg)
      .returning();
    return result[0];
  }
}
