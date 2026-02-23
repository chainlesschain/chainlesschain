/**
 * Community Store - Pinia state management
 * Manages community, channel, governance, and moderation state.
 *
 * @module community-store
 * @version 0.42.0
 */

import { defineStore } from 'pinia';
import { createRetryableIPC } from '../utils/ipc';

// ==================== Type Definitions ====================

export interface Community {
  id: string;
  name: string;
  description: string;
  icon_url: string;
  rules_md: string;
  creator_did: string;
  member_limit: number;
  member_count: number;
  status: 'active' | 'archived' | 'banned';
  my_role?: 'owner' | 'admin' | 'moderator' | 'member' | null;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

export interface CommunityMember {
  id: string;
  community_id: string;
  member_did: string;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  nickname: string | null;
  status: 'active' | 'banned' | 'left';
  contact_nickname?: string;
  joined_at: number;
  updated_at: number;
  [key: string]: any;
}

export interface Channel {
  id: string;
  community_id: string;
  name: string;
  description: string;
  type: 'announcement' | 'discussion' | 'readonly' | 'subscription';
  sort_order: number;
  message_count?: number;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  sender_did: string;
  sender_nickname?: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'system';
  reply_to: string | null;
  is_pinned: number;
  reactions: Record<string, string[]>;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

export interface Proposal {
  id: string;
  community_id: string;
  proposer_did: string;
  title: string;
  description: string;
  proposal_type: 'rule_change' | 'role_change' | 'ban' | 'channel' | 'other';
  status: 'discussion' | 'voting' | 'passed' | 'rejected' | 'executed';
  discussion_end: number;
  voting_end: number;
  vote_count?: number;
  my_vote?: 'approve' | 'reject' | 'abstain' | null;
  votes_summary?: Record<string, { count: number; weight: number }>;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

export interface Vote {
  id: string;
  proposal_id: string;
  voter_did: string;
  voter_nickname?: string;
  vote: 'approve' | 'reject' | 'abstain';
  weight: number;
  created_at: number;
  [key: string]: any;
}

export interface ModerationReport {
  id: string;
  community_id: string;
  content_id: string;
  content_type: 'message' | 'post' | 'comment';
  reporter_did: string;
  moderator_did: string | null;
  action: 'approved' | 'removed' | 'warning' | 'escalated' | null;
  reason: string;
  ai_score: number | null;
  status: 'pending' | 'reviewed' | 'resolved';
  created_at: number;
  resolved_at: number | null;
  [key: string]: any;
}

export interface CommunityState {
  communities: Community[];
  currentCommunity: Community | null;
  members: CommunityMember[];
  channels: Channel[];
  currentChannel: Channel | null;
  channelMessages: ChannelMessage[];
  proposals: Proposal[];
  moderationLog: ModerationReport[];
  loading: boolean;
  messagesLoading: boolean;
  searchResults: Community[];
}

// ==================== IPC Setup ====================

const ipcRenderer = createRetryableIPC((window as any).electron?.ipcRenderer, {
  silentErrors: true,
});

// ==================== Store ====================

export const useCommunityStore = defineStore('community', {
  state: (): CommunityState => ({
    communities: [],
    currentCommunity: null,
    members: [],
    channels: [],
    currentChannel: null,
    channelMessages: [],
    proposals: [],
    moderationLog: [],
    loading: false,
    messagesLoading: false,
    searchResults: [],
  }),

  getters: {
    /**
     * Communities where user is owner
     */
    ownedCommunities(): Community[] {
      return this.communities.filter((c) => c.my_role === 'owner');
    },

    /**
     * Get current community members count
     */
    currentMemberCount(): number {
      return this.currentCommunity?.member_count || 0;
    },

    /**
     * Pinned messages in current channel
     */
    pinnedMessages(): ChannelMessage[] {
      return this.channelMessages.filter((m) => m.is_pinned === 1);
    },

    /**
     * Active proposals (discussion or voting)
     */
    activeProposals(): Proposal[] {
      return this.proposals.filter(
        (p) => p.status === 'discussion' || p.status === 'voting',
      );
    },

    /**
     * Pending moderation reports
     */
    pendingReports(): ModerationReport[] {
      return this.moderationLog.filter((r) => r.status === 'pending');
    },

    /**
     * Check if current user is admin or owner
     */
    isAdminOrOwner(): boolean {
      const role = this.currentCommunity?.my_role;
      return role === 'owner' || role === 'admin';
    },

    /**
     * Check if current user is moderator or above
     */
    isModeratorOrAbove(): boolean {
      const role = this.currentCommunity?.my_role;
      return role === 'owner' || role === 'admin' || role === 'moderator';
    },
  },

  actions: {
    // ========== Community Management ==========

    /**
     * Load user's communities
     */
    async loadCommunities(): Promise<void> {
      this.loading = true;
      try {
        const communities = await ipcRenderer.invoke('community:get-list');
        this.communities = Array.isArray(communities) ? communities : [];
      } catch (error: any) {
        if (error?.message !== 'IPC not available') {
          console.error('Failed to load communities:', error);
        }
        this.communities = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Create a new community
     */
    async createCommunity(options: {
      name: string;
      description?: string;
      iconUrl?: string;
      rulesMd?: string;
      memberLimit?: number;
    }): Promise<Community> {
      try {
        const community = await ipcRenderer.invoke('community:create', options);
        this.communities.unshift(community);
        return community;
      } catch (error) {
        console.error('Failed to create community:', error);
        throw error;
      }
    },

    /**
     * Join a community
     */
    async joinCommunity(communityId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('community:join', communityId);
        await this.loadCommunities();
      } catch (error) {
        console.error('Failed to join community:', error);
        throw error;
      }
    },

    /**
     * Leave a community
     */
    async leaveCommunity(communityId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('community:leave', communityId);
        this.communities = this.communities.filter((c) => c.id !== communityId);
        if (this.currentCommunity?.id === communityId) {
          this.currentCommunity = null;
          this.channels = [];
          this.currentChannel = null;
          this.channelMessages = [];
        }
      } catch (error) {
        console.error('Failed to leave community:', error);
        throw error;
      }
    },

    /**
     * Select a community and load its details
     */
    async selectCommunity(communityId: string): Promise<void> {
      this.loading = true;
      try {
        const community = await ipcRenderer.invoke('community:get-by-id', communityId);
        this.currentCommunity = community;
        if (community) {
          await Promise.all([
            this.loadChannels(communityId),
            this.loadMembers(communityId),
            this.loadProposals(communityId),
          ]);
        }
      } catch (error) {
        console.error('Failed to select community:', error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Search communities
     */
    async searchCommunities(query: string): Promise<Community[]> {
      try {
        const results = await ipcRenderer.invoke('community:search', query);
        this.searchResults = Array.isArray(results) ? results : [];
        return this.searchResults;
      } catch (error) {
        console.error('Failed to search communities:', error);
        this.searchResults = [];
        return [];
      }
    },

    /**
     * Load community members
     */
    async loadMembers(communityId?: string): Promise<void> {
      const cid = communityId || this.currentCommunity?.id;
      if (!cid) return;
      try {
        const members = await ipcRenderer.invoke('community:get-members', cid);
        this.members = Array.isArray(members) ? members : [];
      } catch (error) {
        console.error('Failed to load members:', error);
        this.members = [];
      }
    },

    // ========== Channel Management ==========

    /**
     * Load channels for a community
     */
    async loadChannels(communityId?: string): Promise<void> {
      const cid = communityId || this.currentCommunity?.id;
      if (!cid) return;
      try {
        const channels = await ipcRenderer.invoke('channel:get-list', cid);
        this.channels = Array.isArray(channels) ? channels : [];
      } catch (error) {
        console.error('Failed to load channels:', error);
        this.channels = [];
      }
    },

    /**
     * Select a channel and load its messages
     */
    async selectChannel(channelId: string): Promise<void> {
      const channel = this.channels.find((c) => c.id === channelId);
      this.currentChannel = channel || null;
      if (channel) {
        await this.loadMessages(channelId);
      }
    },

    /**
     * Send a message to the current channel
     */
    async sendMessage(content: string, messageType: string = 'text', replyTo: string | null = null): Promise<ChannelMessage | null> {
      if (!this.currentChannel) return null;
      try {
        const message = await ipcRenderer.invoke('channel:send-message', {
          channelId: this.currentChannel.id,
          content,
          messageType,
          replyTo,
        });
        if (message) {
          // Parse reactions if needed
          if (typeof message.reactions === 'string') {
            message.reactions = JSON.parse(message.reactions);
          }
          this.channelMessages.push(message);
        }
        return message;
      } catch (error) {
        console.error('Failed to send message:', error);
        throw error;
      }
    },

    /**
     * Load messages for a channel
     */
    async loadMessages(channelId?: string, options?: { limit?: number; offset?: number }): Promise<void> {
      const cid = channelId || this.currentChannel?.id;
      if (!cid) return;
      this.messagesLoading = true;
      try {
        const messages = await ipcRenderer.invoke('channel:get-messages', cid, options);
        const parsed = Array.isArray(messages)
          ? messages.map((m: any) => ({
              ...m,
              reactions: typeof m.reactions === 'string' ? JSON.parse(m.reactions) : (m.reactions || {}),
            }))
          : [];
        // Messages come DESC from server, reverse for display
        this.channelMessages = parsed.reverse();
      } catch (error) {
        console.error('Failed to load messages:', error);
        this.channelMessages = [];
      } finally {
        this.messagesLoading = false;
      }
    },

    // ========== Governance ==========

    /**
     * Create a proposal
     */
    async createProposal(options: {
      communityId: string;
      title: string;
      description?: string;
      proposalType?: string;
    }): Promise<Proposal> {
      try {
        const proposal = await ipcRenderer.invoke('governance:create-proposal', options);
        this.proposals.unshift(proposal);
        return proposal;
      } catch (error) {
        console.error('Failed to create proposal:', error);
        throw error;
      }
    },

    /**
     * Cast a vote on a proposal
     */
    async castVote(proposalId: string, vote: 'approve' | 'reject' | 'abstain'): Promise<void> {
      try {
        await ipcRenderer.invoke('governance:vote', proposalId, vote);
        // Update local state
        const proposal = this.proposals.find((p) => p.id === proposalId);
        if (proposal) {
          proposal.my_vote = vote;
          proposal.vote_count = (proposal.vote_count || 0) + 1;
        }
      } catch (error) {
        console.error('Failed to cast vote:', error);
        throw error;
      }
    },

    /**
     * Load proposals for a community
     */
    async loadProposals(communityId?: string): Promise<void> {
      const cid = communityId || this.currentCommunity?.id;
      if (!cid) return;
      try {
        const proposals = await ipcRenderer.invoke('governance:get-proposals', cid);
        this.proposals = Array.isArray(proposals) ? proposals : [];
      } catch (error) {
        console.error('Failed to load proposals:', error);
        this.proposals = [];
      }
    },

    // ========== Moderation ==========

    /**
     * Report content
     */
    async reportContent(options: {
      communityId: string;
      contentId: string;
      contentType: string;
      reason: string;
      contentText?: string;
    }): Promise<void> {
      try {
        await ipcRenderer.invoke('moderation:report', options);
      } catch (error) {
        console.error('Failed to report content:', error);
        throw error;
      }
    },

    /**
     * Load moderation log
     */
    async loadModerationLog(communityId?: string): Promise<void> {
      const cid = communityId || this.currentCommunity?.id;
      if (!cid) return;
      try {
        const log = await ipcRenderer.invoke('moderation:get-log', cid);
        this.moderationLog = Array.isArray(log) ? log : [];
      } catch (error) {
        console.error('Failed to load moderation log:', error);
        this.moderationLog = [];
      }
    },

    // ========== State Reset ==========

    /**
     * Reset all state
     */
    resetState(): void {
      this.communities = [];
      this.currentCommunity = null;
      this.members = [];
      this.channels = [];
      this.currentChannel = null;
      this.channelMessages = [];
      this.proposals = [];
      this.moderationLog = [];
      this.loading = false;
      this.messagesLoading = false;
      this.searchResults = [];
    },
  },
});
