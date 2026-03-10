/**
 * Notion Integration Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

const _deps = { https };

const NOTION_API_VERSION = "2022-06-28";
const NOTION_BASE = "api.notion.com";

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[Notion] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    const apiKey = process.env.NOTION_API_KEY || context.notionApiKey || "";
    if (!apiKey) {
      return {
        success: false,
        error:
          "NOTION_API_KEY environment variable is not set. Get your integration token at https://www.notion.so/my-integrations",
      };
    }

    try {
      switch (parsed.action) {
        case "search":
          return await handleSearch(apiKey, parsed.query);
        case "create-page":
          return await handleCreatePage(apiKey, parsed.title, parsed.options);
        case "query-db":
          return await handleQueryDB(apiKey, parsed.target, parsed.options);
        case "get-page":
          return await handleGetPage(apiKey, parsed.target);
        case "update-page":
          return await handleUpdatePage(apiKey, parsed.target, parsed.options);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Available: search, create-page, query-db, get-page, update-page`,
          };
      }
    } catch (error) {
      logger.error("[Notion] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "search", query: "", target: "", title: "", options: {} };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "search").toLowerCase();

  const parentMatch = input.match(/--parent\s+(\S+)/);
  const contentMatch =
    input.match(/--content\s+["']([^"']+)["']/) ||
    input.match(/--content\s+(\S+)/);
  const filterMatch = input.match(/--filter\s+(\S+=\S+)/);
  const sortMatch = input.match(/--sort\s+(\S+)/);
  const titleMatch =
    input.match(/title=["']([^"']+)["']/) || input.match(/title=(\S+)/);

  // Extract title from quoted string after action
  const quotedTitle = input.match(
    /(?:create-page|update-page)\s+["']([^"']+)["']/,
  );
  const rawParts = parts.filter((p) => !p.startsWith("--") && p !== action);
  const target = rawParts[0] || "";
  const title = quotedTitle
    ? quotedTitle[1]
    : rawParts
        .join(" ")
        .replace(/\s*--.*$/, "")
        .replace(/\s*title=.*$/, "");

  return {
    action,
    query: parts
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .join(" "),
    target,
    title,
    options: {
      parentId: parentMatch ? parentMatch[1] : null,
      content: contentMatch ? contentMatch[1] : null,
      filter: filterMatch ? filterMatch[1] : null,
      sort: sortMatch ? sortMatch[1] : null,
      newTitle: titleMatch ? titleMatch[1] : null,
    },
  };
}

async function handleSearch(apiKey, query) {
  if (!query) {
    return { success: false, error: "Provide a search query." };
  }

  const body = { query, page_size: 20 };
  const data = await notionRequest(apiKey, "POST", "/v1/search", body);

  const results = (data.results || []).map((r) => ({
    id: r.id,
    type: r.object,
    title: extractTitle(r),
    url: r.url || null,
    lastEdited: r.last_edited_time || null,
  }));

  return {
    success: true,
    action: "search",
    result: {
      results,
      total: data.results ? data.results.length : 0,
      hasMore: data.has_more || false,
    },
    message: `Found ${results.length} result(s) for "${query}".`,
  };
}

async function handleCreatePage(apiKey, title, options) {
  if (!title) {
    return { success: false, error: "Provide a page title." };
  }

  const parent = options.parentId
    ? { page_id: options.parentId }
    : { page_id: await getDefaultParent(apiKey) };

  const body = {
    parent,
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
  };

  if (options.content) {
    body.children = [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: options.content } }],
        },
      },
    ];
  }

  const data = await notionRequest(apiKey, "POST", "/v1/pages", body);

  return {
    success: true,
    action: "create-page",
    result: { id: data.id, url: data.url, title, created: data.created_time },
    message: `Page "${title}" created successfully.${data.url ? ` URL: ${data.url}` : ""}`,
  };
}

async function handleQueryDB(apiKey, databaseId, options) {
  if (!databaseId) {
    return { success: false, error: "Provide a database ID." };
  }

  const body = { page_size: 50 };

  if (options.filter) {
    const [key, value] = options.filter.split("=");
    body.filter = {
      property: key,
      rich_text: { equals: value },
    };
  }

  if (options.sort) {
    body.sorts = [{ property: options.sort, direction: "descending" }];
  }

  const data = await notionRequest(
    apiKey,
    "POST",
    `/v1/databases/${databaseId}/query`,
    body,
  );

  const rows = (data.results || []).map((row) => {
    const props = {};
    for (const [key, val] of Object.entries(row.properties || {})) {
      props[key] = extractPropertyValue(val);
    }
    return {
      id: row.id,
      properties: props,
      url: row.url,
      lastEdited: row.last_edited_time,
    };
  });

  return {
    success: true,
    action: "query-db",
    result: {
      databaseId,
      rows,
      total: rows.length,
      hasMore: data.has_more || false,
    },
    message: `Query returned ${rows.length} row(s) from database.`,
  };
}

async function handleGetPage(apiKey, pageId) {
  if (!pageId) {
    return { success: false, error: "Provide a page ID." };
  }

  const [page, blocks] = await Promise.all([
    notionRequest(apiKey, "GET", `/v1/pages/${pageId}`),
    notionRequest(apiKey, "GET", `/v1/blocks/${pageId}/children?page_size=100`),
  ]);

  const title = extractTitle(page);
  const content = (blocks.results || []).map((block) => ({
    id: block.id,
    type: block.type,
    text: extractBlockText(block),
    hasChildren: block.has_children || false,
  }));

  return {
    success: true,
    action: "get-page",
    result: {
      id: page.id,
      title,
      url: page.url,
      created: page.created_time,
      lastEdited: page.last_edited_time,
      blocks: content,
    },
    message: `Page "${title}" retrieved with ${content.length} block(s).`,
  };
}

async function handleUpdatePage(apiKey, pageId, options) {
  if (!pageId) {
    return { success: false, error: "Provide a page ID." };
  }

  const body = { properties: {} };

  if (options.newTitle) {
    body.properties.title = {
      title: [{ text: { content: options.newTitle } }],
    };
  }

  const data = await notionRequest(
    apiKey,
    "PATCH",
    `/v1/pages/${pageId}`,
    body,
  );

  if (options.content) {
    await notionRequest(apiKey, "PATCH", `/v1/blocks/${pageId}/children`, {
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: options.content } }],
          },
        },
      ],
    });
  }

  return {
    success: true,
    action: "update-page",
    result: { id: data.id, url: data.url, lastEdited: data.last_edited_time },
    message: `Page updated successfully.${options.newTitle ? ` New title: "${options.newTitle}"` : ""}`,
  };
}

function extractTitle(obj) {
  if (!obj || !obj.properties) {
    return "Untitled";
  }
  const titleProp =
    obj.properties.title || obj.properties.Name || obj.properties.name;
  if (!titleProp) {
    return "Untitled";
  }
  const arr = titleProp.title || titleProp.rich_text || [];
  return (
    arr.map((t) => t.plain_text || t.text?.content || "").join("") || "Untitled"
  );
}

function extractPropertyValue(prop) {
  if (!prop) {
    return null;
  }
  switch (prop.type) {
    case "title":
      return (prop.title || []).map((t) => t.plain_text || "").join("");
    case "rich_text":
      return (prop.rich_text || []).map((t) => t.plain_text || "").join("");
    case "number":
      return prop.number;
    case "select":
      return prop.select ? prop.select.name : null;
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name);
    case "date":
      return prop.date ? prop.date.start : null;
    case "checkbox":
      return prop.checkbox;
    case "url":
      return prop.url;
    case "email":
      return prop.email;
    case "phone_number":
      return prop.phone_number;
    case "status":
      return prop.status ? prop.status.name : null;
    default:
      return `[${prop.type}]`;
  }
}

function extractBlockText(block) {
  const type = block.type;
  const content = block[type];
  if (!content) {
    return "";
  }
  const richText = content.rich_text || content.text || [];
  if (Array.isArray(richText)) {
    return richText.map((t) => t.plain_text || t.text?.content || "").join("");
  }
  return "";
}

async function getDefaultParent(apiKey) {
  const data = await notionRequest(apiKey, "POST", "/v1/search", {
    page_size: 1,
    filter: { value: "page", property: "object" },
  });
  if (data.results && data.results.length > 0) {
    return data.results[0].id;
  }
  throw new Error(
    "No pages found in workspace to use as parent. Please specify --parent <page-id> or ensure your Notion integration has access to at least one page.",
  );
}

function notionRequest(apiKey, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: NOTION_BASE,
      path,
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
        "User-Agent": "ChainlessChain/1.2.0",
      },
    };

    const req = _deps.https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `Notion API error (${res.statusCode}): ${parsed.message || parsed.code || "Unknown error"}`,
              ),
            );
          } else {
            resolve(parsed);
          }
        } catch (_err) {
          reject(
            new Error(
              `Failed to parse Notion response (status ${res.statusCode})`,
            ),
          );
        }
      });
    });

    req.on("error", (err) =>
      reject(new Error(`Notion API request failed: ${err.message}`)),
    );
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Notion API request timed out"));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}
