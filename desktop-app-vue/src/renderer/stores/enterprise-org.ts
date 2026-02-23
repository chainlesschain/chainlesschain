/**
 * Enterprise Organization Store - Pinia state management
 *
 * Manages department hierarchy, dashboard stats, and bulk operations
 * for the enterprise organization management feature.
 *
 * @module enterprise-org-store
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

export interface Department {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  parentDeptId?: string | null;
  leadDid?: string;
  leadName?: string;
  memberCount: number;
  createdAt: number;
  updatedAt?: number;
  teamType: string;
}

export interface DepartmentNode extends Department {
  children: DepartmentNode[];
}

export interface OrgHierarchy {
  org: any;
  hierarchy: DepartmentNode[];
}

export interface DepartmentMember {
  id: string;
  teamId: string;
  teamName: string;
  memberDid: string;
  memberName: string;
  role: string;
  joinedAt: number;
  invitedBy?: string | null;
}

export interface DashboardStats {
  memberCount: number;
  teamCount: number;
  departmentCount: number;
  pendingApprovals: number;
  recentActivity: any[];
}

export interface BulkImportMember {
  did: string;
  name?: string;
  role?: string;
  teamId?: string;
}

export interface BulkImportResult {
  imported: any[];
  failed: any[];
  skipped: any[];
}

export interface MemberJoinResult {
  needsApproval: boolean;
  requestId?: string;
  memberId?: string;
  skipped?: boolean;
  reason?: string;
}

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface EnterpriseOrgState {
  currentOrgId: string | null;
  hierarchy: OrgHierarchy | null;
  departments: Department[];
  selectedDepartment: Department | null;
  departmentMembers: DepartmentMember[];
  dashboardStats: DashboardStats | null;
  loading: boolean;
  loadingMembers: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useEnterpriseOrgStore = defineStore('enterprise-org', {
  state: (): EnterpriseOrgState => ({
    currentOrgId: null,
    hierarchy: null,
    departments: [],
    selectedDepartment: null,
    departmentMembers: [],
    dashboardStats: null,
    loading: false,
    loadingMembers: false,
    error: null,
  }),

  getters: {
    /**
     * Flatten the hierarchy tree into a single-level array.
     */
    flatDepartments(): Department[] {
      if (!this.hierarchy?.hierarchy) return [];

      const result: Department[] = [];
      const flatten = (nodes: DepartmentNode[]) => {
        for (const node of nodes) {
          const { children, ...dept } = node;
          result.push(dept as Department);
          if (children?.length) {
            flatten(children);
          }
        }
      };
      flatten(this.hierarchy.hierarchy);
      return result;
    },

    /**
     * Total department count from the loaded departments list.
     */
    departmentCount(): number {
      return this.departments.length;
    },

    /**
     * Whether any loading operation is active.
     */
    isLoading(): boolean {
      return this.loading || this.loadingMembers;
    },

    /**
     * Root-level departments (no parent).
     */
    rootDepartments(): Department[] {
      return this.departments.filter((d) => !d.parentDeptId);
    },
  },

  actions: {
    // ==========================================
    // Hierarchy
    // ==========================================

    async fetchHierarchy(orgId: string): Promise<void> {
      this.loading = true;
      this.error = null;
      this.currentOrgId = orgId;

      try {
        const result: IPCResponse<OrgHierarchy> = await (window as any).electronAPI.invoke(
          'enterprise:get-hierarchy',
          orgId
        );

        if (result.success && result.data) {
          this.hierarchy = result.data;
        } else {
          this.error = result.error || 'Failed to fetch hierarchy';
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] fetchHierarchy failed:', error);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Department CRUD
    // ==========================================

    async createDepartment(orgId: string, data: Partial<Department>): Promise<Department | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse<Department> = await (window as any).electronAPI.invoke(
          'enterprise:create-department',
          {
            orgId,
            name: data.name,
            description: data.description,
            parentDeptId: data.parentDeptId,
            leadDid: data.leadDid,
            leadName: data.leadName,
          }
        );

        if (result.success && result.data) {
          this.departments.push(result.data);
          // Refresh hierarchy to include the new node
          await this.fetchHierarchy(orgId);
          return result.data;
        } else {
          this.error = result.error || 'Failed to create department';
          return null;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] createDepartment failed:', error);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    async updateDepartment(deptId: string, data: Partial<Department>): Promise<boolean> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse = await (window as any).electronAPI.invoke(
          'enterprise:update-department',
          {
            deptId,
            name: data.name,
            description: data.description,
            leadDid: data.leadDid,
            leadName: data.leadName,
          }
        );

        if (result.success) {
          // Update local state
          const index = this.departments.findIndex((d) => d.id === deptId);
          if (index !== -1) {
            this.departments[index] = { ...this.departments[index], ...data };
          }
          if (this.selectedDepartment?.id === deptId) {
            this.selectedDepartment = { ...this.selectedDepartment, ...data };
          }
          // Refresh hierarchy
          if (this.currentOrgId) {
            await this.fetchHierarchy(this.currentOrgId);
          }
          return true;
        } else {
          this.error = result.error || 'Failed to update department';
          return false;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] updateDepartment failed:', error);
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading = false;
      }
    },

    async deleteDepartment(deptId: string): Promise<boolean> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse = await (window as any).electronAPI.invoke(
          'enterprise:delete-department',
          deptId
        );

        if (result.success) {
          this.departments = this.departments.filter((d) => d.id !== deptId);
          if (this.selectedDepartment?.id === deptId) {
            this.selectedDepartment = null;
            this.departmentMembers = [];
          }
          // Refresh hierarchy
          if (this.currentOrgId) {
            await this.fetchHierarchy(this.currentOrgId);
          }
          return true;
        } else {
          this.error = result.error || result.message || 'Failed to delete department';
          return false;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] deleteDepartment failed:', error);
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading = false;
      }
    },

    async moveDepartment(deptId: string, newParentId: string | null): Promise<boolean> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse = await (window as any).electronAPI.invoke(
          'enterprise:move-department',
          { deptId, newParentId }
        );

        if (result.success) {
          // Update local parentDeptId
          const dept = this.departments.find((d) => d.id === deptId);
          if (dept) {
            dept.parentDeptId = newParentId;
          }
          // Refresh hierarchy
          if (this.currentOrgId) {
            await this.fetchHierarchy(this.currentOrgId);
          }
          return true;
        } else {
          this.error = result.error || result.message || 'Failed to move department';
          return false;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] moveDepartment failed:', error);
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Departments & Members
    // ==========================================

    async fetchDepartments(orgId: string): Promise<void> {
      this.loading = true;
      this.error = null;
      this.currentOrgId = orgId;

      try {
        const result: IPCResponse<Department[]> = await (window as any).electronAPI.invoke(
          'enterprise:get-departments',
          orgId
        );

        if (result.success && result.data) {
          this.departments = result.data;
        } else {
          this.error = result.error || 'Failed to fetch departments';
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] fetchDepartments failed:', error);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    async selectDepartment(dept: Department): Promise<void> {
      this.selectedDepartment = dept;
      this.loadingMembers = true;

      try {
        const result: IPCResponse<DepartmentMember[]> = await (window as any).electronAPI.invoke(
          'enterprise:get-department-members',
          dept.id
        );

        if (result.success && result.data) {
          this.departmentMembers = result.data;
        } else {
          this.departmentMembers = [];
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] selectDepartment failed:', error);
        this.departmentMembers = [];
      } finally {
        this.loadingMembers = false;
      }
    },

    // ==========================================
    // Member Join
    // ==========================================

    async requestMemberJoin(
      orgId: string,
      memberDid: string,
      role: string
    ): Promise<MemberJoinResult | null> {
      this.error = null;

      try {
        const result: IPCResponse<MemberJoinResult> = await (window as any).electronAPI.invoke(
          'enterprise:request-member-join',
          { orgId, memberDid, role, requestedBy: memberDid }
        );

        if (result.success && result.data) {
          return result.data;
        } else {
          this.error = result.error || 'Failed to process member join';
          return null;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] requestMemberJoin failed:', error);
        this.error = (error as Error).message;
        return null;
      }
    },

    // ==========================================
    // Dashboard
    // ==========================================

    async fetchDashboardStats(orgId: string): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse<DashboardStats> = await (window as any).electronAPI.invoke(
          'enterprise:get-dashboard-stats',
          orgId
        );

        if (result.success && result.data) {
          this.dashboardStats = result.data;
        } else {
          this.error = result.error || 'Failed to fetch dashboard stats';
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] fetchDashboardStats failed:', error);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Bulk Import
    // ==========================================

    async bulkImport(orgId: string, members: BulkImportMember[]): Promise<BulkImportResult | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResponse<BulkImportResult> = await (window as any).electronAPI.invoke(
          'enterprise:bulk-import',
          { orgId, members }
        );

        if (result.success && result.data) {
          return result.data;
        } else {
          this.error = result.error || 'Bulk import failed';
          return null;
        }
      } catch (error) {
        console.error('[EnterpriseOrgStore] bulkImport failed:', error);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Reset
    // ==========================================

    reset(): void {
      this.$reset();
    },
  },
});
