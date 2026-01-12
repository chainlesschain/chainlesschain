/**
 * Email Client Unit Tests
 * 测试 IMAP/SMTP 邮件客户端功能
 */

const { describe, it, expect, beforeEach } = require('vitest');
const EmailClient = require('../../../src/main/api/email-client');

describe('EmailClient', () => {
  let client;

  beforeEach(() => {
    client = new EmailClient();
  });

  describe('Configuration', () => {
    it('should configure email account', () => {
      const config = {
        email: 'test@example.com',
        password: 'password123',
        imapHost: 'imap.example.com',
        imapPort: 993,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
      };

      client.configure(config);

      expect(client.config).toBeDefined();
      expect(client.config.imap.user).toBe('test@example.com');
      expect(client.config.imap.host).toBe('imap.example.com');
      expect(client.config.imap.port).toBe(993);
      expect(client.config.smtp.host).toBe('smtp.example.com');
      expect(client.config.smtp.port).toBe(587);
    });

    it('should use default ports if not specified', () => {
      const config = {
        email: 'test@example.com',
        password: 'password123',
      };

      client.configure(config);

      expect(client.config.imap.port).toBe(993);
      expect(client.config.smtp.port).toBe(587);
    });
  });

  describe('Default Host Detection', () => {
    it('should detect Gmail IMAP host', () => {
      const host = client.getDefaultImapHost('user@gmail.com');
      expect(host).toBe('imap.gmail.com');
    });

    it('should detect Gmail SMTP host', () => {
      const host = client.getDefaultSmtpHost('user@gmail.com');
      expect(host).toBe('smtp.gmail.com');
    });

    it('should detect Outlook IMAP host', () => {
      const host = client.getDefaultImapHost('user@outlook.com');
      expect(host).toBe('outlook.office365.com');
    });

    it('should detect QQ IMAP host', () => {
      const host = client.getDefaultImapHost('user@qq.com');
      expect(host).toBe('imap.qq.com');
    });

    it('should detect 163 IMAP host', () => {
      const host = client.getDefaultImapHost('user@163.com');
      expect(host).toBe('imap.163.com');
    });

    it('should generate default host for unknown domains', () => {
      const host = client.getDefaultImapHost('user@unknown.com');
      expect(host).toBe('imap.unknown.com');
    });
  });

  describe('Email Normalization', () => {
    it('should normalize email data', () => {
      const mockParsed = {
        messageId: 'msg-123',
        subject: 'Test Subject',
        from: { text: 'sender@example.com' },
        to: { text: 'recipient@example.com' },
        date: new Date('2026-01-12'),
        text: 'Email body',
        attachments: [],
      };

      const normalized = client.normalizeEmail(mockParsed, 1);

      expect(normalized.uid).toBe(1);
      expect(normalized.messageId).toBe('msg-123');
      expect(normalized.subject).toBe('Test Subject');
      expect(normalized.from).toBe('sender@example.com');
      expect(normalized.to).toBe('recipient@example.com');
      expect(normalized.text).toBe('Email body');
      expect(normalized.attachments).toHaveLength(0);
    });

    it('should handle missing subject', () => {
      const mockParsed = {
        from: { text: 'sender@example.com' },
      };

      const normalized = client.normalizeEmail(mockParsed, 1);

      expect(normalized.subject).toBe('(无主题)');
    });

    it('should normalize attachments', () => {
      const mockParsed = {
        attachments: [
          {
            filename: 'test.pdf',
            contentType: 'application/pdf',
            size: 1024,
            content: Buffer.from('test'),
          },
        ],
      };

      const normalized = client.normalizeEmail(mockParsed, 1);

      expect(normalized.attachments).toHaveLength(1);
      expect(normalized.attachments[0].filename).toBe('test.pdf');
      expect(normalized.attachments[0].contentType).toBe('application/pdf');
      expect(normalized.attachments[0].size).toBe(1024);
    });
  });

  describe('Mailbox Parsing', () => {
    it('should parse mailbox structure', () => {
      const mockBoxes = {
        INBOX: {
          delimiter: '/',
          attribs: ['\\HasNoChildren'],
          children: {},
        },
        Sent: {
          delimiter: '/',
          attribs: ['\\HasNoChildren'],
          children: {},
        },
      };

      const parsed = client.parseMailboxes(mockBoxes);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('INBOX');
      expect(parsed[1].name).toBe('Sent');
    });

    it('should handle nested mailboxes', () => {
      const mockBoxes = {
        INBOX: {
          delimiter: '/',
          attribs: [],
          children: {
            Archive: {
              delimiter: '/',
              attribs: [],
              children: {},
            },
          },
        },
      };

      const parsed = client.parseMailboxes(mockBoxes);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('INBOX');
      expect(parsed[0].children).toHaveLength(1);
      expect(parsed[0].children[0].name).toBe('INBOX/Archive');
    });
  });
});
