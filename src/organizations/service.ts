import { eq } from "drizzle-orm";
import { Database } from "../database/client";
import {
  organizations,
  type Organization,
  type NewOrganization,
} from "../database/schema";
import { Auth0Service } from "../auth/auth0-service";

// Auth0 Role IDs
const PODCAST_ADMIN_ROLE_ID = "Qh3bDMuHe_xDJPPXMa-WG";

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
   * Get organization by ID (which is the Auth0 organization ID)
   */
  async getOrganizationById(id: string): Promise<Organization | null> {
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
      // Try to create organization in Auth0
      const auth0Org = await this.auth0Service.createOrganization(
        name,
        displayName
      );

      console.log(`Created organization in Auth0 with ID: ${auth0Org.id}`);

      // Add user to the organization with Podcast Admin role
      await this.auth0Service.addUserToOrganization(auth0Org.id, userId, [
        PODCAST_ADMIN_ROLE_ID,
      ]);

      console.log(`User ${userId} added to organization ${auth0Org.id}`);

      // Check if organization already exists in local database
      let localOrg = await this.getOrganizationById(auth0Org.id);

      if (!localOrg) {
        // Create organization in local database
        const newOrg: NewOrganization = {
          id: auth0Org.id, // Use Auth0 ID directly
          name: auth0Org.display_name || auth0Org.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await this.db
          .insert(organizations)
          .values(newOrg)
          .returning();

        localOrg = result[0];
      }

      return {
        organization: localOrg,
        auth0_org: auth0Org,
      };
    } catch (error: any) {
      // If organization already exists in Auth0, find it and verify user membership
      if (error.message && error.message.includes("already exists")) {
        console.log(
          `Organization '${name}' already exists in Auth0, attempting to find it...`
        );

        // Find the existing organization by name
        const existingOrg = await this.auth0Service.findOrganizationByName(
          name
        );

        if (existingOrg) {
          console.log(`Found existing organization with ID: ${existingOrg.id}`);

          // Verify the current user is a member of this organization
          const userOrganizations =
            await this.auth0Service.getUserOrganizations(userId);
          const isMember = userOrganizations.some(
            (org) => org.id === existingOrg.id
          );

          if (!isMember) {
            throw new Error(
              "You are not authorized to access this organization"
            );
          }

          // User is a member, so create/update the organization in our database
          let localOrg = await this.getOrganizationById(existingOrg.id);

          if (!localOrg) {
            // Create organization in local database
            const newOrg: NewOrganization = {
              id: existingOrg.id, // Use Auth0 ID directly
              name: existingOrg.display_name || existingOrg.name,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            const result = await this.db
              .insert(organizations)
              .values(newOrg)
              .returning();

            localOrg = result[0];
          }

          return {
            organization: localOrg,
            auth0_org: existingOrg,
          };
        } else {
          // If we can't find the organization, re-throw the original error
          console.error(
            `Could not find existing organization with name '${name}'`
          );
          throw error;
        }
      }

      console.error("Failed to create organization:", error);
      // Re-throw the error with the original message to preserve specific error details
      const errorMessage = error.message || "Failed to create organization";
      throw new Error(errorMessage);
    }
  }

  /**
   * Sync an Auth0 organization to local database if it doesn't exist
   */
  async syncOrganization(auth0OrgId: string): Promise<Organization> {
    // Check if organization already exists locally
    let org = await this.getOrganizationById(auth0OrgId);

    if (org) {
      return org;
    }

    if (!this.db) {
      throw new Error("Database not available");
    }

    if (!this.auth0Service) {
      throw new Error("Auth0 service not configured");
    }

    try {
      // Get organization details from Auth0
      const auth0Org = await this.auth0Service.getOrganization(auth0OrgId);

      if (!auth0Org) {
        throw new Error(
          `Organization with ID ${auth0OrgId} not found in Auth0`
        );
      }

      // Create the organization locally
      const newOrg: NewOrganization = {
        id: auth0Org.id, // Use Auth0 ID directly
        name: auth0Org.display_name || auth0Org.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await this.db
        .insert(organizations)
        .values(newOrg)
        .returning();

      return result[0];
    } catch (error) {
      console.error("Error syncing organization:", error);
      throw new Error("Failed to sync organization");
    }
  }
}
