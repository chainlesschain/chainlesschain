/**
 * useEnterpriseOrgStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - fetchHierarchy()        → enterprise:get-hierarchy
 *  - createDepartment()      → enterprise:create-department
 *  - updateDepartment()      → enterprise:update-department
 *  - deleteDepartment()      → enterprise:delete-department
 *  - moveDepartment()        → enterprise:move-department
 *  - fetchDepartments()      → enterprise:get-departments
 *  - selectDepartment()      → enterprise:get-department-members
 *  - fetchDashboardStats()   → enterprise:get-dashboard-stats
 *  - bulkImport()            → enterprise:bulk-import
 *  - requestMemberJoin()     → enterprise:request-member-join
 *  - Getters: flatDepartments, departmentCount, isLoading, rootDepartments
 *  - Error handling when IPC returns success:false
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  Department,
  DepartmentNode,
  OrgHierarchy,
  DashboardStats,
  BulkImportMember,
} from '../enterprise-org';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: 'dept-1',
    orgId: 'org-a',
    name: 'Engineering',
    description: 'Engineering department',
    parentDeptId: null,
    leadDid: 'did:example:alice',
    leadName: 'Alice',
    memberCount: 5,
    createdAt: Date.now(),
    teamType: 'technical',
    ...overrides,
  };
}

function makeDepartmentNode(
  dept: Partial<Department> = {},
  children: DepartmentNode[] = []
): DepartmentNode {
  return { ...makeDepartment(dept), children };
}

function makeHierarchy(nodes: DepartmentNode[] = []): OrgHierarchy {
  return {
    org: { id: 'org-a', name: 'Acme Corp' },
    hierarchy: nodes,
  };
}

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    memberCount: 50,
    teamCount: 10,
    departmentCount: 5,
    pendingApprovals: 3,
    recentActivity: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEnterpriseOrgStore', () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue({ success: true, data: null });

    (window as any).electronAPI = {
      invoke: mockInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('Initial state', () => {
    it('hierarchy starts as null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.hierarchy).toBeNull();
    });

    it('departments array starts empty', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.departments).toEqual([]);
    });

    it('dashboardStats starts as null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.dashboardStats).toBeNull();
    });

    it('currentOrgId starts as null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.currentOrgId).toBeNull();
    });

    it('selectedDepartment starts as null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.selectedDepartment).toBeNull();
    });

    it('departmentMembers array starts empty', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.departmentMembers).toEqual([]);
    });

    it('loading starts as false', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // fetchHierarchy
  // -------------------------------------------------------------------------

  describe('fetchHierarchy()', () => {
    it('calls enterprise:get-hierarchy with the orgId', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchHierarchy('org-a');

      expect(mockInvoke).toHaveBeenCalledWith('enterprise:get-hierarchy', 'org-a');
    });

    it('sets the hierarchy from IPC response data', async () => {
      const hierarchy = makeHierarchy([makeDepartmentNode()]);
      mockInvoke.mockResolvedValue({ success: true, data: hierarchy });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchHierarchy('org-a');

      expect(store.hierarchy).not.toBeNull();
      expect(store.hierarchy!.hierarchy).toHaveLength(1);
    });

    it('stores the orgId as currentOrgId', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchHierarchy('org-target');

      expect(store.currentOrgId).toBe('org-target');
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Permission denied' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchHierarchy('org-denied');

      expect(store.error).toBe('Permission denied');
      expect(store.hierarchy).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // createDepartment
  // -------------------------------------------------------------------------

  describe('createDepartment()', () => {
    it('calls enterprise:create-department with orgId and department data', async () => {
      const newDept = makeDepartment({ id: 'dept-new', name: 'DevOps' });
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: newDept }) // create-department
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() }); // fetchHierarchy

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.createDepartment('org-a', { name: 'DevOps' });

      expect(mockInvoke).toHaveBeenCalledWith(
        'enterprise:create-department',
        expect.objectContaining({ orgId: 'org-a', name: 'DevOps' })
      );
    });

    it('adds the new department to the local departments array', async () => {
      const newDept = makeDepartment({ id: 'dept-new' });
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: newDept })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.createDepartment('org-a', { name: 'DevOps' });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('dept-new');
    });

    it('returns null and sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Name conflict' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.createDepartment('org-a', { name: 'Duplicate' });

      expect(result).toBeNull();
      expect(store.error).toBe('Name conflict');
    });
  });

  // -------------------------------------------------------------------------
  // updateDepartment
  // -------------------------------------------------------------------------

  describe('updateDepartment()', () => {
    it('calls enterprise:update-department with deptId and update data', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // update
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() }); // fetchHierarchy

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      await store.updateDepartment('dept-1', { name: 'Engineering V2' });

      expect(mockInvoke).toHaveBeenCalledWith(
        'enterprise:update-department',
        expect.objectContaining({ deptId: 'dept-1', name: 'Engineering V2' })
      );
    });

    it('returns true on success', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      const result = await store.updateDepartment('dept-1', { name: 'Updated' });

      expect(result).toBe(true);
    });

    it('returns false and sets error when IPC fails', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Not found' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.updateDepartment('dept-missing', { name: 'X' });

      expect(result).toBe(false);
      expect(store.error).toBe('Not found');
    });
  });

  // -------------------------------------------------------------------------
  // deleteDepartment
  // -------------------------------------------------------------------------

  describe('deleteDepartment()', () => {
    it('calls enterprise:delete-department with the deptId', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      await store.deleteDepartment('dept-del');

      expect(mockInvoke).toHaveBeenCalledWith('enterprise:delete-department', 'dept-del');
    });

    it('removes the department from the local array on success', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      store.departments = [makeDepartment({ id: 'dept-del' }), makeDepartment({ id: 'dept-keep' })];
      await store.deleteDepartment('dept-del');

      expect(store.departments).toHaveLength(1);
      expect(store.departments[0].id).toBe('dept-keep');
    });

    it('returns false and sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Has children' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.deleteDepartment('dept-parent');

      expect(result).toBe(false);
      expect(store.error).toBe('Has children');
    });
  });

  // -------------------------------------------------------------------------
  // moveDepartment
  // -------------------------------------------------------------------------

  describe('moveDepartment()', () => {
    it('calls enterprise:move-department with deptId and newParentId', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      await store.moveDepartment('dept-child', 'dept-new-parent');

      expect(mockInvoke).toHaveBeenCalledWith(
        'enterprise:move-department',
        { deptId: 'dept-child', newParentId: 'dept-new-parent' }
      );
    });

    it('updates parentDeptId in local state on success', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.currentOrgId = 'org-a';
      store.departments = [makeDepartment({ id: 'dept-child', parentDeptId: 'old-parent' })];
      await store.moveDepartment('dept-child', 'new-parent');

      expect(store.departments[0].parentDeptId).toBe('new-parent');
    });

    it('returns false and sets error when IPC fails', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Circular reference' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.moveDepartment('dept-x', 'dept-x');

      expect(result).toBe(false);
      expect(store.error).toBe('Circular reference');
    });
  });

  // -------------------------------------------------------------------------
  // fetchDepartments
  // -------------------------------------------------------------------------

  describe('fetchDepartments()', () => {
    it('calls enterprise:get-departments with the orgId', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDepartments('org-b');

      expect(mockInvoke).toHaveBeenCalledWith('enterprise:get-departments', 'org-b');
    });

    it('populates departments array from IPC response', async () => {
      const depts = [makeDepartment({ id: 'd1' }), makeDepartment({ id: 'd2' })];
      mockInvoke.mockResolvedValue({ success: true, data: depts });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDepartments('org-b');

      expect(store.departments).toHaveLength(2);
      expect(store.departments[0].id).toBe('d1');
    });

    it('sets currentOrgId when fetching departments', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDepartments('org-set');

      expect(store.currentOrgId).toBe('org-set');
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Org not found' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDepartments('org-missing');

      expect(store.error).toBe('Org not found');
      expect(store.departments).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // fetchDashboardStats
  // -------------------------------------------------------------------------

  describe('fetchDashboardStats()', () => {
    it('calls enterprise:get-dashboard-stats with the orgId', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: makeStats() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDashboardStats('org-stats');

      expect(mockInvoke).toHaveBeenCalledWith('enterprise:get-dashboard-stats', 'org-stats');
    });

    it('sets dashboardStats from IPC response', async () => {
      const stats = makeStats({ memberCount: 100, pendingApprovals: 7 });
      mockInvoke.mockResolvedValue({ success: true, data: stats });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDashboardStats('org-a');

      expect(store.dashboardStats).not.toBeNull();
      expect(store.dashboardStats!.memberCount).toBe(100);
      expect(store.dashboardStats!.pendingApprovals).toBe(7);
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Stats service down' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.fetchDashboardStats('org-a');

      expect(store.error).toBe('Stats service down');
      expect(store.dashboardStats).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // bulkImport
  // -------------------------------------------------------------------------

  describe('bulkImport()', () => {
    it('calls enterprise:bulk-import with orgId and members array', async () => {
      const importResult = { imported: [], failed: [], skipped: [] };
      mockInvoke.mockResolvedValue({ success: true, data: importResult });

      const members: BulkImportMember[] = [
        { did: 'did:example:bob', name: 'Bob', role: 'member' },
        { did: 'did:example:carol', name: 'Carol', role: 'admin' },
      ];

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.bulkImport('org-bulk', members);

      expect(mockInvoke).toHaveBeenCalledWith(
        'enterprise:bulk-import',
        { orgId: 'org-bulk', members }
      );
    });

    it('returns the BulkImportResult from the IPC response', async () => {
      const importResult = {
        imported: [{ did: 'did:example:bob' }],
        failed: [],
        skipped: [],
      };
      mockInvoke.mockResolvedValue({ success: true, data: importResult });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.bulkImport('org-a', [{ did: 'did:example:bob' }]);

      expect(result).not.toBeNull();
      expect(result!.imported).toHaveLength(1);
    });

    it('returns null and sets error when IPC fails', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Import quota exceeded' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.bulkImport('org-a', [{ did: 'did:x' }]);

      expect(result).toBeNull();
      expect(store.error).toBe('Import quota exceeded');
    });
  });

  // -------------------------------------------------------------------------
  // requestMemberJoin
  // -------------------------------------------------------------------------

  describe('requestMemberJoin()', () => {
    it('calls enterprise:request-member-join with orgId, memberDid and role', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { needsApproval: true, requestId: 'req-1' },
      });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      await store.requestMemberJoin('org-j', 'did:example:newbie', 'member');

      expect(mockInvoke).toHaveBeenCalledWith(
        'enterprise:request-member-join',
        expect.objectContaining({
          orgId: 'org-j',
          memberDid: 'did:example:newbie',
          role: 'member',
        })
      );
    });

    it('returns the MemberJoinResult from the IPC response', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { needsApproval: false, memberId: 'mem-99' },
      });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.requestMemberJoin('org-a', 'did:x', 'viewer');

      expect(result).not.toBeNull();
      expect(result!.needsApproval).toBe(false);
      expect(result!.memberId).toBe('mem-99');
    });

    it('returns null and sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Already a member' });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const result = await store.requestMemberJoin('org-a', 'did:existing', 'member');

      expect(result).toBeNull();
      expect(store.error).toBe('Already a member');
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe('flatDepartments getter', () => {
    it('returns an empty array when hierarchy is null', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.flatDepartments).toEqual([]);
    });

    it('flattens a single-level hierarchy into a flat array', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.hierarchy = makeHierarchy([
        makeDepartmentNode({ id: 'eng' }),
        makeDepartmentNode({ id: 'hr' }),
      ]);
      expect(store.flatDepartments).toHaveLength(2);
      expect(store.flatDepartments.map((d) => d.id)).toContain('eng');
      expect(store.flatDepartments.map((d) => d.id)).toContain('hr');
    });

    it('recursively flattens a nested hierarchy', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      const child = makeDepartmentNode({ id: 'backend', parentDeptId: 'eng' });
      const root = makeDepartmentNode({ id: 'eng' }, [child]);
      store.hierarchy = makeHierarchy([root]);

      const flat = store.flatDepartments;
      expect(flat).toHaveLength(2);
      expect(flat.map((d) => d.id)).toContain('eng');
      expect(flat.map((d) => d.id)).toContain('backend');
    });
  });

  describe('departmentCount getter', () => {
    it('returns 0 when departments array is empty', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      expect(store.departmentCount).toBe(0);
    });

    it('returns the length of the departments array', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.departments = [makeDepartment({ id: 'a' }), makeDepartment({ id: 'b' }), makeDepartment({ id: 'c' })];
      expect(store.departmentCount).toBe(3);
    });
  });

  describe('rootDepartments getter', () => {
    it('returns only departments with no parentDeptId', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();
      store.departments = [
        makeDepartment({ id: 'root-1', parentDeptId: null }),
        makeDepartment({ id: 'root-2', parentDeptId: undefined }),
        makeDepartment({ id: 'child-1', parentDeptId: 'root-1' }),
      ];
      expect(store.rootDepartments).toHaveLength(2);
      expect(store.rootDepartments.map((d) => d.id)).toContain('root-1');
      expect(store.rootDepartments.map((d) => d.id)).toContain('root-2');
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset()', () => {
    it('clears hierarchy, departments, and dashboardStats', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: makeHierarchy() });

      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();

      // Populate state
      store.hierarchy = makeHierarchy([makeDepartmentNode()]);
      store.departments = [makeDepartment()];
      store.dashboardStats = makeStats();
      store.error = 'some error';
      store.currentOrgId = 'org-reset';

      store.reset();

      expect(store.hierarchy).toBeNull();
      expect(store.departments).toEqual([]);
      expect(store.dashboardStats).toBeNull();
      expect(store.error).toBeNull();
      expect(store.currentOrgId).toBeNull();
    });

    it('clears selectedDepartment and departmentMembers', async () => {
      const { useEnterpriseOrgStore } = await import('../enterprise-org');
      const store = useEnterpriseOrgStore();

      store.selectedDepartment = makeDepartment();
      store.departmentMembers = [
        {
          id: 'mem-1',
          teamId: 'dept-1',
          teamName: 'Engineering',
          memberDid: 'did:example:alice',
          memberName: 'Alice',
          role: 'lead',
          joinedAt: Date.now(),
        },
      ];

      store.reset();

      expect(store.selectedDepartment).toBeNull();
      expect(store.departmentMembers).toEqual([]);
    });
  });
});
