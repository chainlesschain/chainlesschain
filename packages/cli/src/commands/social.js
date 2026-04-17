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
import { classifyTopic, detectLanguage } from "../lib/topic-classifier.js";
import {
  ensureGraphTables,
  addEdge as graphAddEdge,
  removeEdge as graphRemoveEdge,
  getNeighbors as graphGetNeighbors,
  getGraphSnapshot,
  loadFromDb as graphLoadFromDb,
  subscribe as graphSubscribe,
  EDGE_TYPES,
} from "../lib/social-graph.js";
import {
  METRICS as ANALYTICS_METRICS,
  degreeCentrality,
  closenessCentrality,
  betweennessCentrality,
  eigenvectorCentrality,
  influenceScore,
  detectCommunities,
  shortestPath,
  topByMetric,
  analyticsStats,
} from "../lib/social-graph-analytics.js";

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

  // ── Analyze (topic classification, language-aware) ──────────

  social
    .command("analyze <text>")
    .description("Classify text into topics (language-aware, multilingual)")
    .option("-k, --top-k <n>", "Top-K topics to return", "3")
    .option("--lang <code>", "Override detected language (zh|ja|en|other)")
    .option("--min-score <n>", "Drop topics with rawScore <= this", "0")
    .option("--json", "Output as JSON")
    .action((text, options) => {
      try {
        const topK = Math.max(1, parseInt(options.topK, 10) || 3);
        const minScore = Number(options.minScore) || 0;
        const result = classifyTopic(text, {
          topK,
          lang: options.lang,
          minScore,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        logger.log(
          `  ${chalk.bold("Language:")} ${chalk.cyan(result.language)}`,
        );
        logger.log(`  ${chalk.bold("Tokens:")}   ${result.tokens.length}`);
        if (result.topics.length === 0) {
          logger.log(`  ${chalk.dim("(no topic matched)")}`);
          return;
        }
        logger.log(`  ${chalk.bold("Top topics:")}`);
        for (const t of result.topics) {
          const pct = (t.score * 100).toFixed(1);
          logger.log(
            `    ${chalk.cyan(t.topic.padEnd(16))} ${pct}%  ` +
              `${chalk.dim(`(raw=${t.rawScore}, hits=${t.hits})`)}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // Language-only quick helper.
  social
    .command("detect-lang <text>")
    .description("Detect dominant language of text (zh|ja|en|other)")
    .option("--json", "Output as JSON")
    .action((text, options) => {
      const language = detectLanguage(text);
      if (options.json) {
        console.log(JSON.stringify({ language }));
      } else {
        logger.log(chalk.cyan(language));
      }
    });

  // ── Social Graph (realtime) ─────────────────────────────────

  const graph = social
    .command("graph")
    .description("Social graph — typed edges, neighbors, live event stream");

  graph
    .command("add-edge <source> <target>")
    .description(`Add a directed edge (types: ${EDGE_TYPES.join("|")})`)
    .option("-t, --type <type>", "Edge type", "follow")
    .option("-w, --weight <n>", "Edge weight", "1.0")
    .option("-m, --metadata <json>", "JSON-encoded metadata")
    .option("--json", "Output as JSON")
    .action(async (source, target, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureGraphTables(db);
        graphLoadFromDb(db);

        const metadata = options.metadata ? JSON.parse(options.metadata) : null;
        const result = graphAddEdge(db, source, target, options.type, {
          weight: Number(options.weight) || 1.0,
          metadata,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const verb = result.created ? "added" : "updated";
          logger.success(
            `Edge ${verb}: ${chalk.cyan(source)} --${options.type}→ ${chalk.cyan(target)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("remove-edge <source> <target>")
    .description("Remove a directed edge")
    .option("-t, --type <type>", "Edge type", "follow")
    .option("--json", "Output as JSON")
    .action(async (source, target, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureGraphTables(db);
        graphLoadFromDb(db);

        const result = graphRemoveEdge(db, source, target, options.type);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.removed) {
          logger.success(
            `Edge removed: ${chalk.cyan(source)} --${options.type}→ ${chalk.cyan(target)}`,
          );
        } else {
          logger.warn("Edge not found");
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("neighbors <did>")
    .description("List neighbors of a DID")
    .option("-d, --direction <dir>", "Direction: out | in | both", "both")
    .option("-t, --type <type>", "Filter by edge type")
    .option("--json", "Output as JSON")
    .action(async (did, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureGraphTables(db);
        graphLoadFromDb(db);

        const neighbors = graphGetNeighbors(did, {
          direction: options.direction,
          edgeType: options.type,
        });
        if (options.json) {
          console.log(JSON.stringify({ did, neighbors }, null, 2));
        } else if (neighbors.length === 0) {
          logger.log(chalk.dim("(no neighbors)"));
        } else {
          for (const n of neighbors) logger.log(`  ${chalk.cyan(n)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("snapshot")
    .description("Dump the full graph (nodes + edges + stats)")
    .option("-t, --type <type>", "Filter by edge type")
    .option("--json", "Output as JSON (default: yes — snapshot is raw)")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureGraphTables(db);
        graphLoadFromDb(db);

        const snapshot = getGraphSnapshot({ edgeType: options.type });
        console.log(JSON.stringify(snapshot, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("watch")
    .description("Stream graph change events as NDJSON on stdout")
    .option("-e, --events <list>", "Comma-separated event types (default: all)")
    .option("--once", "Emit the first event then exit")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureGraphTables(db);
        graphLoadFromDb(db);

        const events = options.events
          ? options.events
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : null;

        // Announce subscription on stdout so pipelines know the stream is live.
        process.stdout.write(
          JSON.stringify({
            type: "watch.started",
            events: events || "all",
            at: new Date().toISOString(),
          }) + "\n",
        );

        let unsubscribe = null;
        const stop = async () => {
          if (unsubscribe) unsubscribe();
          await shutdown();
          process.exit(0);
        };

        unsubscribe = graphSubscribe(
          (evt) => {
            process.stdout.write(
              JSON.stringify({ ...evt, at: new Date().toISOString() }) + "\n",
            );
            if (options.once) void stop();
          },
          events ? { events } : undefined,
        );

        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Graph analytics (Phase 42) ──────────────────────────────

  async function _loadSnapshot(options) {
    const ctx = await bootstrap({ verbose: program.opts().verbose });
    if (!ctx.db) {
      logger.error("Database not available");
      process.exit(1);
    }
    const db = ctx.db.getDatabase();
    ensureGraphTables(db);
    graphLoadFromDb(db);
    return getGraphSnapshot({ edgeType: options.type });
  }

  function _splitEdgeTypes(list) {
    if (!list) return undefined;
    return list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function _printScoreMap(scores, limit) {
    const entries = Object.entries(scores).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    const slice = limit > 0 ? entries.slice(0, limit) : entries;
    for (const [did, score] of slice) {
      console.log(`${chalk.cyan(did.padEnd(28))} ${score.toFixed(6)}`);
    }
  }

  graph
    .command("degree")
    .description("Degree centrality per DID")
    .option("-d, --direction <in|out|both>", "Edge direction", "both")
    .option("--no-normalize", "Disable normalization by (n-1)")
    .option("-e, --edge-types <list>", "Comma-separated edge types to include")
    .option("-l, --limit <n>", "Show top N", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const scores = degreeCentrality(snap, {
          direction: options.direction,
          normalize: options.normalize !== false,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
        });
        if (options.json) console.log(JSON.stringify(scores, null, 2));
        else _printScoreMap(scores, parseInt(options.limit, 10) || 10);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("closeness")
    .description("Harmonic closeness centrality per DID")
    .option("--directed", "Treat graph as directed")
    .option("--no-normalize", "Disable normalization by (n-1)")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("-l, --limit <n>", "Show top N", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const scores = closenessCentrality(snap, {
          directed: !!options.directed,
          normalize: options.normalize !== false,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
        });
        if (options.json) console.log(JSON.stringify(scores, null, 2));
        else _printScoreMap(scores, parseInt(options.limit, 10) || 10);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("betweenness")
    .description("Betweenness centrality (Brandes' algorithm)")
    .option("--directed", "Treat graph as directed")
    .option("--no-normalize", "Disable normalization")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("-l, --limit <n>", "Show top N", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const scores = betweennessCentrality(snap, {
          directed: !!options.directed,
          normalize: options.normalize !== false,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
        });
        if (options.json) console.log(JSON.stringify(scores, null, 2));
        else _printScoreMap(scores, parseInt(options.limit, 10) || 10);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("eigenvector")
    .description("Eigenvector centrality via power iteration")
    .option("--directed", "Treat graph as directed")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("--iterations <n>", "Max iterations", "100")
    .option("--tolerance <f>", "Convergence tolerance", "1e-6")
    .option("-l, --limit <n>", "Show top N", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const scores = eigenvectorCentrality(snap, {
          directed: !!options.directed,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
          iterations: parseInt(options.iterations, 10) || 100,
          tolerance: parseFloat(options.tolerance) || 1e-6,
        });
        if (options.json) console.log(JSON.stringify(scores, null, 2));
        else _printScoreMap(scores, parseInt(options.limit, 10) || 10);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("influence")
    .description("Composite influence score (weighted sum of 4 centralities)")
    .option("--directed", "Treat graph as directed")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("--w-degree <f>", "Weight for degree", "0.25")
    .option("--w-closeness <f>", "Weight for closeness", "0.25")
    .option("--w-betweenness <f>", "Weight for betweenness", "0.25")
    .option("--w-eigenvector <f>", "Weight for eigenvector", "0.25")
    .option("-l, --limit <n>", "Show top N", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const scores = influenceScore(snap, {
          directed: !!options.directed,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
          weights: {
            degree: parseFloat(options.wDegree),
            closeness: parseFloat(options.wCloseness),
            betweenness: parseFloat(options.wBetweenness),
            eigenvector: parseFloat(options.wEigenvector),
          },
        });
        if (options.json) console.log(JSON.stringify(scores, null, 2));
        else _printScoreMap(scores, parseInt(options.limit, 10) || 10);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("communities")
    .description("Label-propagation community detection")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("--max-iterations <n>", "Max propagation rounds", "20")
    .option("--min-size <n>", "Drop communities smaller than this", "1")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const result = detectCommunities(snap, {
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
          maxIterations: parseInt(options.maxIterations, 10) || 20,
          minSize: parseInt(options.minSize, 10) || 1,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(
            chalk.bold(
              `Communities: ${result.communities.length}    modularity: ${result.modularity.toFixed(4)}`,
            ),
          );
          for (const c of result.communities) {
            console.log(
              `  ${chalk.cyan(c.id)} (size ${c.size}) ${c.members.join(", ")}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("path <source> <target>")
    .description("Shortest path between two DIDs (unweighted BFS)")
    .option("--undirected", "Treat graph as undirected (default: directed)")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("--json", "Output as JSON")
    .action(async (source, target, options) => {
      try {
        const snap = await _loadSnapshot(options);
        const result = shortestPath(snap, source, target, {
          directed: !options.undirected,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!result.found) {
          console.log(chalk.yellow("No path found"));
        } else {
          console.log(
            `${chalk.bold("distance")}: ${result.distance}    ${result.path.join(" → ")}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("top <metric>")
    .description(`Top-N DIDs by metric (${ANALYTICS_METRICS.join("|")})`)
    .option("--directed", "Treat graph as directed (where applicable)")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("-l, --limit <n>", "Limit", "10")
    .option("--json", "Output as JSON")
    .action(async (metric, options) => {
      try {
        const snap = await _loadSnapshot(options);
        const rows = topByMetric(snap, metric, {
          directed: !!options.directed,
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
          limit: parseInt(options.limit, 10) || 10,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          for (const r of rows) {
            console.log(
              `${chalk.cyan(r.did.padEnd(28))} ${r.score.toFixed(6)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  graph
    .command("analytics-stats")
    .description("Graph-wide analytics rollup (counts, density, top influence)")
    .option("-e, --edge-types <list>", "Comma-separated edge types")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const snap = await _loadSnapshot(options);
        const stats = analyticsStats(snap, {
          edgeTypes: _splitEdgeTypes(options.edgeTypes),
        });
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(chalk.bold("Social Graph Analytics"));
          console.log(`  Nodes:    ${stats.nodeCount}`);
          console.log(`  Edges:    ${stats.edgeCount}`);
          console.log(`  Density:  ${stats.density.toFixed(4)}`);
          console.log(`  Generated: ${stats.generatedAt}`);
          if (stats.topInfluence.length > 0) {
            console.log(chalk.bold("\nTop influence:"));
            for (const r of stats.topInfluence) {
              console.log(
                `  ${chalk.cyan(r.did.padEnd(28))} ${r.score.toFixed(6)}`,
              );
            }
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
