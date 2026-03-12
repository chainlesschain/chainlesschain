/**
 * Social commands
 * chainlesschain social contact|friend|post|chat|stats
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureSocialTables,
  addContact,
  listContacts,
  deleteContact,
  showContact,
  addFriend,
  listFriends,
  removeFriend,
  pendingRequests,
  publishPost,
  listPosts,
  likePost,
  sendChatMessage,
  getChatMessages,
  getChatThreads,
  getSocialStats,
} from "../lib/social-manager.js";

export function registerSocialCommand(program) {
  const social = program
    .command("social")
    .description("Social platform — contacts, friends, posts, chat");

  // ── Contact subcommands ─────────────────────────────────────

  const contact = social.command("contact").description("Contact management");

  contact
    .command("add <name>")
    .description("Add a contact")
    .option("-d, --did <did>", "Contact DID")
    .option("-e, --email <email>", "Contact email")
    .option("-n, --notes <text>", "Notes")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const c = addContact(
          db,
          name,
          options.did,
          options.email,
          options.notes,
        );
        logger.success(`Contact ${chalk.cyan(c.name)} added`);
        logger.log(`  ${chalk.bold("ID:")} ${chalk.cyan(c.id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  contact
    .command("list")
    .description("List contacts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const contacts = listContacts();
        if (options.json) {
          console.log(JSON.stringify(contacts, null, 2));
        } else if (contacts.length === 0) {
          logger.info("No contacts.");
        } else {
          for (const c of contacts) {
            logger.log(
              `  ${chalk.cyan(c.id.slice(0, 8))} ${c.name} ${c.email || ""} ${c.did || ""}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  contact
    .command("delete <contact-id>")
    .description("Delete a contact")
    .action(async (contactId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        deleteContact(db, contactId);
        logger.success(`Contact deleted`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  contact
    .command("show <contact-id>")
    .description("Show contact details")
    .option("--json", "Output as JSON")
    .action(async (contactId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const c = showContact(contactId);
        if (options.json) {
          console.log(JSON.stringify(c, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}    ${chalk.cyan(c.id)}`);
          logger.log(`  ${chalk.bold("Name:")}  ${c.name}`);
          logger.log(`  ${chalk.bold("DID:")}   ${c.did || "N/A"}`);
          logger.log(`  ${chalk.bold("Email:")} ${c.email || "N/A"}`);
          logger.log(`  ${chalk.bold("Notes:")} ${c.notes || "N/A"}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Friend subcommands ──────────────────────────────────────

  const friend = social.command("friend").description("Friend management");

  friend
    .command("add <contact-id>")
    .description("Send a friend request")
    .action(async (contactId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const f = addFriend(db, contactId);
        logger.success(`Friend request sent (${f.status})`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  friend
    .command("list")
    .description("List friends")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const friends = listFriends();
        if (options.json) {
          console.log(JSON.stringify(friends, null, 2));
        } else if (friends.length === 0) {
          logger.info("No friends.");
        } else {
          for (const f of friends) {
            logger.log(
              `  ${chalk.cyan(f.contactId.slice(0, 8))} [${f.status}]`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  friend
    .command("remove <contact-id>")
    .description("Remove a friend")
    .action(async (contactId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        removeFriend(db, contactId);
        logger.success("Friend removed");
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  friend
    .command("pending")
    .description("List pending friend requests")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const pending = pendingRequests();
        if (options.json) {
          console.log(JSON.stringify(pending, null, 2));
        } else if (pending.length === 0) {
          logger.info("No pending requests.");
        } else {
          for (const p of pending) {
            logger.log(
              `  ${chalk.cyan(p.contactId.slice(0, 8))} [${p.status}]`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Post subcommands ────────────────────────────────────────

  const post = social.command("post").description("Social posts");

  post
    .command("publish <content>")
    .description("Publish a post")
    .option("-a, --author <name>", "Author name", "cli-user")
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const p = publishPost(db, content, options.author);
        logger.success("Post published");
        logger.log(`  ${chalk.bold("ID:")} ${chalk.cyan(p.id)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  post
    .command("list")
    .description("List posts")
    .option("-a, --author <name>", "Filter by author")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const posts = listPosts({ author: options.author });
        if (options.json) {
          console.log(JSON.stringify(posts, null, 2));
        } else if (posts.length === 0) {
          logger.info("No posts.");
        } else {
          for (const p of posts) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} by ${p.author} — "${p.content.slice(0, 60)}" ♥ ${p.likes}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  post
    .command("like <post-id>")
    .description("Like a post")
    .action(async (postId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const p = likePost(db, postId);
        logger.success(`Post liked (${p.likes} total)`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Chat subcommands ────────────────────────────────────────

  const chat = social.command("chat").description("Direct messaging");

  chat
    .command("send <recipient> <message>")
    .description("Send a chat message")
    .option("-s, --sender <name>", "Sender name", "cli-user")
    .action(async (recipient, message, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const msg = sendChatMessage(db, recipient, message, options.sender);
        logger.success(`Message sent to ${chalk.cyan(recipient)}`);
        logger.log(`  ${chalk.bold("Thread:")} ${msg.threadId}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  chat
    .command("messages <thread-id>")
    .description("Get messages in a thread")
    .option("-n, --limit <n>", "Max messages", "50")
    .option("--json", "Output as JSON")
    .action(async (threadId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const messages = getChatMessages(threadId, {
          limit: parseInt(options.limit),
        });
        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else if (messages.length === 0) {
          logger.info("No messages in this thread.");
        } else {
          for (const m of messages) {
            logger.log(`  ${chalk.gray(m.sender)}: ${m.content}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  chat
    .command("threads")
    .description("List chat threads")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const threads = getChatThreads();
        if (options.json) {
          console.log(JSON.stringify(threads, null, 2));
        } else if (threads.length === 0) {
          logger.info("No chat threads.");
        } else {
          for (const t of threads) {
            logger.log(
              `  ${chalk.cyan(t.threadId)} (${t.messageCount} messages)`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Stats ───────────────────────────────────────────────────

  social
    .command("stats")
    .description("Show social statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSocialTables(db);

        const stats = getSocialStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Contacts:")}  ${stats.contacts}`);
          logger.log(`  ${chalk.bold("Friends:")}   ${stats.friends}`);
          logger.log(`  ${chalk.bold("Posts:")}     ${stats.posts}`);
          logger.log(`  ${chalk.bold("Messages:")}  ${stats.messages}`);
          logger.log(`  ${chalk.bold("Pending:")}   ${stats.pendingRequests}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
