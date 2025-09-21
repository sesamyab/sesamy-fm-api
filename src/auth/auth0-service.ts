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
    } catch (error) {
      console.error("Failed to create organization:", error);
      throw new Error("Failed to create organization");
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
      await this.management.organizations.addMembers(
        { id: orgId },
        { members: [userId] }
      );

      // Then assign roles
      if (roles.length > 0) {
        await this.management.organizations.addMemberRoles(
          { id: orgId, user_id: userId },
          { roles }
        );
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
}
