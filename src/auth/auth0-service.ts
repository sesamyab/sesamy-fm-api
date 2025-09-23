import { ManagementClient } from "auth0";

export interface Auth0Organization {
  id: string;
  name: string;
  display_name?: string;
  branding?: {
    logo_url?: string;
    colors?: {
      primary?: string;
      page_background?: string;
    };
  };
  metadata?: Record<string, any>;
}

export class Auth0Service {
  private management: ManagementClient;

  constructor(domain: string, clientId: string, clientSecret: string) {
    this.management = new ManagementClient({
      domain,
      clientId,
      clientSecret,
      headers: {
        "tenant-id": "sesamy",
      },
    });
  }

  /**
   * Get organizations for a user
   */
  async getUserOrganizations(userId: string): Promise<Auth0Organization[]> {
    try {
      const organizations = await this.management.users.getUserOrganizations({
        id: userId,
      });
      return organizations.data as Auth0Organization[];
    } catch (error) {
      console.error("Failed to get user organizations:", error);
      throw new Error("Failed to fetch user organizations");
    }
  }

  /**
   * Create a new organization
   */
  async createOrganization(
    name: string,
    displayName?: string
  ): Promise<Auth0Organization> {
    try {
      const organization = await this.management.organizations.create({
        name,
        display_name: displayName || name,
      });
      return organization.data as Auth0Organization;
    } catch (error: any) {
      console.error("Failed to create organization:", error);

      // Handle specific Auth0 errors
      if (error.statusCode === 409) {
        throw new Error(
          "Organization name already exists. Please choose a different name."
        );
      }

      if (error.statusCode === 400) {
        throw new Error(
          "Invalid organization data. Please check the organization name and try again."
        );
      }

      if (error.statusCode === 403) {
        throw new Error("Insufficient permissions to create organization.");
      }

      // Fallback for other errors
      const errorMessage =
        error.message || error.body || "Unknown error occurred";
      throw new Error(`Failed to create organization: ${errorMessage}`);
    }
  }

  /**
   * Add user to organization with specified roles
   */
  async addUserToOrganization(
    orgId: string,
    userId: string,
    roles: string[]
  ): Promise<void> {
    try {
      // First add the user to the organization
      try {
        await this.management.organizations.addMembers(
          { id: orgId },
          { members: [userId] }
        );
      } catch (memberError: any) {
        // If user is already a member, that's okay - we'll continue to role assignment
        if (memberError.statusCode !== 409) {
          throw memberError;
        }
        console.log(
          `User ${userId} is already a member of organization ${orgId}`
        );
      }

      // Then assign roles
      if (roles.length > 0) {
        try {
          await this.management.organizations.addMemberRoles(
            { id: orgId, user_id: userId },
            { roles }
          );
        } catch (roleError: any) {
          // If user already has the roles, that's okay too
          if (roleError.statusCode !== 409) {
            throw roleError;
          }
          console.log(
            `User ${userId} already has required roles in organization ${orgId}`
          );
        }
      }
    } catch (error) {
      console.error("Failed to add user to organization:", error);
      throw new Error("Failed to add user to organization");
    }
  }

  /**
   * Get organization by ID
   */
  async getOrganization(orgId: string): Promise<Auth0Organization | null> {
    try {
      const organization = await this.management.organizations.get({
        id: orgId,
      });
      return organization.data as Auth0Organization;
    } catch (error) {
      console.error("Failed to get organization:", error);
      return null;
    }
  }

  /**
   * Find organization by name
   */
  async findOrganizationByName(
    name: string
  ): Promise<Auth0Organization | null> {
    try {
      // Get all organizations and filter by name (Auth0 doesn't support name filtering directly)
      const organizations = await this.management.organizations.getAll();

      if (organizations.data && organizations.data.length > 0) {
        const foundOrg = organizations.data.find(
          (org) => org.name === name || org.display_name === name
        );
        return (foundOrg as Auth0Organization) || null;
      }

      return null;
    } catch (error) {
      console.error("Failed to find organization by name:", error);
      return null;
    }
  }
}
