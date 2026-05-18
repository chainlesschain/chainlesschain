/**
 * Test Data Generator
 * Utility for generating realistic test data for E2E tests
 */

import { faker } from '@faker-js/faker';

export interface UserData {
  did: string;
  name: string;
  email: string;
  role: string;
}

export interface TeamData {
  id: string;
  orgId: string;
  name: string;
  description: string;
  leadDid: string;
  leadName: string;
}

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  projectType: string;
  userId: string;
  tags: string[];
}

export interface TaskData {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedHours: number;
  createdBy: string;
  creatorName: string;
}

export interface SprintData {
  id: string;
  boardId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
}

/**
 * Test Data Generator Class
 */
export class TestDataGenerator {
  private timestamp: number;

  constructor() {
    this.timestamp = Date.now();
  }

  /**
   * Generate unique DID
   */
  generateDID(prefix: string = 'user'): string {
    return `did:key:${prefix}-${this.timestamp}-${faker.string.alphanumeric(8)}`;
  }

  /**
   * Generate unique ID
   */
  generateID(prefix: string = 'id'): string {
    return `${prefix}-${this.timestamp}-${faker.string.alphanumeric(8)}`;
  }

  /**
   * Generate organization ID
   */
  generateOrgID(name?: string): string {
    const orgName = name || faker.company.name().toLowerCase().replace(/\s+/g, '-');
    return `org-${orgName}-${this.timestamp}`;
  }

  /**
   * Generate user data
   */
  generateUser(role: string = 'member'): UserData {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    return {
      did: this.generateDID('user'),
      name: `${firstName} ${lastName}`,
      email: faker.internet.email({ firstName, lastName }),
      role,
    };
  }

  /**
   * Generate multiple users
   */
  generateUsers(count: number, role: string = 'member'): UserData[] {
    return Array.from({ length: count }, () => this.generateUser(role));
  }

  /**
   * Generate team data
   */
  generateTeam(orgId: string, leadUser?: UserData): TeamData {
    const lead = leadUser || this.generateUser('lead');

    return {
      id: this.generateID('team'),
      orgId,
      name: `${faker.commerce.department()} Team`,
      description: faker.company.catchPhrase(),
      leadDid: lead.did,
      leadName: lead.name,
    };
  }

  /**
   * Generate project data
   */
  generateProject(userId: string): ProjectData {
    const projectTypes = ['document', 'web', 'mobile', 'backend', 'data'];

    return {
      id: this.generateID('project'),
      name: `${faker.commerce.productName()} Project`,
      description: faker.commerce.productDescription(),
      projectType: faker.helpers.arrayElement(projectTypes),
      userId,
      tags: faker.helpers.arrayElements(['frontend', 'backend', 'fullstack', 'mobile', 'ai', 'ml'], 3),
    };
  }

  /**
   * Generate task data
   */
  generateTask(boardId: string, columnId: string, creatorUser: UserData): TaskData {
    const priorities: Array<'low' | 'medium' | 'high' | 'urgent'> = ['low', 'medium', 'high', 'urgent'];

    return {
      id: this.generateID('task'),
      boardId,
      columnId,
      title: faker.hacker.phrase(),
      description: faker.lorem.paragraph(),
      priority: faker.helpers.arrayElement(priorities),
      estimatedHours: faker.number.int({ min: 1, max: 40 }),
      createdBy: creatorUser.did,
      creatorName: creatorUser.name,
    };
  }

  /**
   * Generate multiple tasks
   */
  generateTasks(count: number, boardId: string, columnId: string, creatorUser: UserData): TaskData[] {
    return Array.from({ length: count }, () => this.generateTask(boardId, columnId, creatorUser));
  }

  /**
   * Generate sprint data
   */
  generateSprint(boardId: string, durationWeeks: number = 2): SprintData {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationWeeks * 7);

    return {
      id: this.generateID('sprint'),
      boardId,
      name: `Sprint ${faker.number.int({ min: 1, max: 50 })}`,
      goal: faker.company.catchPhrase(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  }

  /**
   * Generate realistic company data
   */
  generateCompanyData() {
    return {
      name: faker.company.name(),
      industry: faker.company.buzzNoun(),
      employees: faker.number.int({ min: 10, max: 5000 }),
      founded: faker.date.past({ years: 20 }).getFullYear(),
    };
  }

  /**
   * Generate workflow data
   */
  generateApprovalWorkflow(orgId: string, approvers: UserData[]) {
    const workflowTypes = ['sequential', 'parallel', 'any_one'];

    return {
      orgId,
      name: `${faker.company.buzzVerb()} Approval`,
      description: `Approval workflow for ${faker.company.buzzNoun()}`,
      triggerResourceType: faker.helpers.arrayElement(['permission', 'task', 'deployment']),
      triggerAction: faker.helpers.arrayElement(['grant', 'close', 'execute']),
      approvalType: faker.helpers.arrayElement(workflowTypes),
      approvers: approvers.map((user, index) => ({
        did: user.did,
        name: user.name,
        role: index === 0 ? 'lead' : 'approver',
      })),
      timeoutHours: faker.number.int({ min: 24, max: 168 }),
      onTimeout: faker.helpers.arrayElement(['reject', 'auto_approve']),
      enabled: true,
    };
  }

  /**
   * Generate permission grant data
   */
  generatePermissionGrant(orgId: string, userDid: string, grantedBy: string) {
    const resourceTypes = ['project', 'task', 'team', 'board'];
    const permissions = ['read', 'write', 'admin', 'delete'];

    return {
      orgId,
      userDid,
      resourceType: faker.helpers.arrayElement(resourceTypes),
      resourceId: '*',
      permission: faker.helpers.arrayElement(permissions),
      grantedBy,
    };
  }

  /**
   * Generate checklist data
   */
  generateChecklist(taskId: string, itemCount: number = 5) {
    return {
      taskId,
      title: `${faker.hacker.verb()} ${faker.hacker.noun()}`,
      items: Array.from({ length: itemCount }, () => ({
        content: faker.hacker.phrase(),
        completed: faker.datatype.boolean(),
      })),
    };
  }

  /**
   * Generate comment data
   */
  generateComment(taskId: string, authorUser: UserData) {
    return {
      taskId,
      comment: {
        authorDid: authorUser.did,
        authorName: authorUser.name,
        content: faker.lorem.paragraph(),
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Generate board data
   */
  generateBoard(orgId: string, creatorDid: string) {
    const boardTypes = ['kanban', 'scrum', 'agile'];

    return {
      orgId,
      name: `${faker.commerce.department()} Board`,
      description: faker.company.catchPhrase(),
      boardType: faker.helpers.arrayElement(boardTypes),
      createdBy: creatorDid,
    };
  }

  /**
   * Generate column data
   */
  generateColumn(position: number, withWipLimit: boolean = false) {
    const columnNames = ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'];

    return {
      name: columnNames[position % columnNames.length] || `Column ${position + 1}`,
      position,
      wipLimit: withWipLimit ? faker.number.int({ min: 3, max: 10 }) : null,
    };
  }

  /**
   * Generate label data
   */
  generateLabel() {
    const labelNames = ['bug', 'feature', 'enhancement', 'documentation', 'urgent', 'low-priority'];
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

    return {
      name: faker.helpers.arrayElement(labelNames),
      color: faker.helpers.arrayElement(colors),
    };
  }

  /**
   * Generate realistic file data
   */
  generateFile(projectId: string, fileType: string = 'markdown') {
    const fileExtensions: Record<string, string> = {
      markdown: 'md',
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      json: 'json',
    };

    const fileName = `${faker.system.fileName()}.${fileExtensions[fileType] || 'txt'}`;

    return {
      id: this.generateID('file'),
      projectId,
      filePath: `/${faker.system.directoryPath()}/${fileName}`,
      fileName,
      fileType,
      content: faker.lorem.paragraphs(3),
      fileSize: faker.number.int({ min: 100, max: 10000 }),
    };
  }

  /**
   * Generate bulk test scenario
   */
  generateBulkScenario(config: {
    orgCount?: number;
    teamsPerOrg?: number;
    membersPerTeam?: number;
    projectsPerOrg?: number;
    boardsPerOrg?: number;
    tasksPerBoard?: number;
  }) {
    const {
      orgCount = 1,
      teamsPerOrg = 2,
      membersPerTeam = 5,
      projectsPerOrg = 3,
      boardsPerOrg = 2,
      tasksPerBoard = 10,
    } = config;

    const orgs = Array.from({ length: orgCount }, () => ({
      id: this.generateOrgID(),
      teams: Array.from({ length: teamsPerOrg }, () => {
        const lead = this.generateUser('lead');
        const members = this.generateUsers(membersPerTeam);
        return {
          ...this.generateTeam(this.generateOrgID(), lead),
          lead,
          members,
        };
      }),
      projects: Array.from({ length: projectsPerOrg }, () =>
        this.generateProject(this.generateDID('owner'))
      ),
      boards: Array.from({ length: boardsPerOrg }, () => {
        const board = this.generateBoard(this.generateOrgID(), this.generateDID('creator'));
        const columns = [
          this.generateColumn(0),
          this.generateColumn(1, true),
          this.generateColumn(2),
        ];
        const tasks = Array.from({ length: tasksPerBoard }, () =>
          this.generateTask('board-id', 'column-id', this.generateUser())
        );
        return { ...board, columns, tasks };
      }),
    }));

    return orgs;
  }

  /**
   * Reset timestamp (for generating fresh IDs)
   */
  resetTimestamp() {
    this.timestamp = Date.now();
  }
}

/**
 * Default singleton instance
 */
export const testDataGenerator = new TestDataGenerator();

/**
 * Helper functions for common use cases
 */
export const generateTestData = {
  user: (role?: string) => testDataGenerator.generateUser(role),
  users: (count: number, role?: string) => testDataGenerator.generateUsers(count, role),
  team: (orgId: string, leadUser?: UserData) => testDataGenerator.generateTeam(orgId, leadUser),
  project: (userId: string) => testDataGenerator.generateProject(userId),
  task: (boardId: string, columnId: string, creator: UserData) =>
    testDataGenerator.generateTask(boardId, columnId, creator),
  tasks: (count: number, boardId: string, columnId: string, creator: UserData) =>
    testDataGenerator.generateTasks(count, boardId, columnId, creator),
  sprint: (boardId: string, weeks?: number) => testDataGenerator.generateSprint(boardId, weeks),
  board: (orgId: string, creatorDid: string) => testDataGenerator.generateBoard(orgId, creatorDid),
  column: (position: number, withWip?: boolean) => testDataGenerator.generateColumn(position, withWip),
  workflow: (orgId: string, approvers: UserData[]) =>
    testDataGenerator.generateApprovalWorkflow(orgId, approvers),
  permission: (orgId: string, userDid: string, grantedBy: string) =>
    testDataGenerator.generatePermissionGrant(orgId, userDid, grantedBy),
  checklist: (taskId: string, itemCount?: number) =>
    testDataGenerator.generateChecklist(taskId, itemCount),
  comment: (taskId: string, author: UserData) => testDataGenerator.generateComment(taskId, author),
  label: () => testDataGenerator.generateLabel(),
  file: (projectId: string, fileType?: string) => testDataGenerator.generateFile(projectId, fileType),
  orgId: (name?: string) => testDataGenerator.generateOrgID(name),
  did: (prefix?: string) => testDataGenerator.generateDID(prefix),
  id: (prefix?: string) => testDataGenerator.generateID(prefix),
};
