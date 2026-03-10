/**
 * Google Workspace Skill Handler
 *
 * Integrates with Gmail, Google Calendar, and Google Drive via Google APIs.
 * Requires GOOGLE_API_KEY or OAuth credentials (GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) in environment.
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

const _deps = { https };

const GMAIL_API = "gmail.googleapis.com";
const CALENDAR_API = "www.googleapis.com";
const DRIVE_API = "www.googleapis.com";

function getCredentials() {
  const apiKey = process.env.GOOGLE_API_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN || null;

  if (apiKey) {
    return { mode: "api-key", apiKey };
  }
  if (clientId && clientSecret && refreshToken) {
    return { mode: "oauth", clientId, clientSecret, refreshToken, accessToken };
  }
  return null;
}

function apiRequest(hostname, path, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: {
        "User-Agent": "ChainlessChain/1.2.0",
        "Content-Type": "application/json",
        ...headers,
      },
    };

    if (body) {
      const payload = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = _deps.https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_e) {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function getAccessToken(creds) {
  if (creds.accessToken) {
    return creds.accessToken;
  }
  if (creds.mode === "api-key") {
    return null;
  }

  const body = {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  };

  const res = await apiRequest("oauth2.googleapis.com", "/token", "POST", body);
  if (res.status === 200 && res.data.access_token) {
    creds.accessToken = res.data.access_token;
    return res.data.access_token;
  }

  throw new Error(
    `OAuth token refresh failed: ${res.data.error || "unknown error"}`,
  );
}

function buildAuthQuery(creds) {
  if (creds.mode === "api-key") {
    return `key=${encodeURIComponent(creds.apiKey)}`;
  }
  return "";
}

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[GoogleWorkspace] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);
    const creds = getCredentials();

    if (!creds) {
      return {
        success: false,
        action: parsed.action,
        error:
          "Google credentials not configured. Set GOOGLE_API_KEY or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN environment variables.",
      };
    }

    try {
      switch (parsed.action) {
        case "gmail-search":
          return await handleGmailSearch(parsed, creds);
        case "gmail-send":
          return await handleGmailSend(parsed, creds);
        case "calendar-list":
          return await handleCalendarList(parsed, creds);
        case "calendar-create":
          return await handleCalendarCreate(parsed, creds);
        case "drive-list":
          return await handleDriveList(parsed, creds);
        case "drive-upload":
          return await handleDriveUpload(parsed, creds);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use: gmail-search, gmail-send, calendar-list, calendar-create, drive-list, drive-upload`,
          };
      }
    } catch (error) {
      logger.error("[GoogleWorkspace] Error:", error);
      return { success: false, action: parsed.action, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "calendar-list", query: "", params: {} };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "").toLowerCase();
  const rest = parts.slice(1).join(" ");

  const maxMatch = rest.match(/--max\s+(\d+)/);
  const daysMatch = rest.match(/--days\s+(\d+)/);
  const folderMatch = rest.match(/--folder\s+(\S+)/);
  const durationMatch = rest.match(/--duration\s+(\d+)/);

  // Parse email fields: to:<email> subject:<text> body:<text>
  const toMatch = rest.match(/to:(\S+)/);
  const subjectMatch = rest.match(/subject:(.+?)(?=\s+(?:body:|to:|$))/);
  const bodyMatch = rest.match(/body:(.+?)(?=\s+(?:subject:|to:|$))/);

  // Remove flags from query
  const query = rest
    .replace(/--\w+\s+\S+/g, "")
    .replace(/to:\S+/g, "")
    .replace(/subject:.+?(?=\s+(?:body:|to:|$))/g, "")
    .replace(/body:.+/g, "")
    .trim();

  return {
    action: action || "calendar-list",
    query,
    rest,
    params: {
      max: maxMatch ? parseInt(maxMatch[1], 10) : 10,
      days: daysMatch ? parseInt(daysMatch[1], 10) : 7,
      folder: folderMatch ? folderMatch[1] : "root",
      duration: durationMatch ? parseInt(durationMatch[1], 10) : 60,
      to: toMatch ? toMatch[1] : null,
      subject: subjectMatch ? subjectMatch[1].trim() : "",
      body: bodyMatch ? bodyMatch[1].trim() : "",
    },
  };
}

async function handleGmailSearch(parsed, creds) {
  const token = await getAccessToken(creds);
  const query = encodeURIComponent(parsed.query || parsed.rest || "is:unread");
  const max = parsed.params.max;

  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const authQuery = !token ? `&${buildAuthQuery(creds)}` : "";

  const res = await apiRequest(
    GMAIL_API,
    `/gmail/v1/users/me/messages?q=${query}&maxResults=${max}${authQuery}`,
    "GET",
    null,
    authHeader,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "gmail-search",
      error: `Gmail API error (${res.status}): ${JSON.stringify(res.data)}`,
    };
  }

  const messages = res.data.messages || [];
  const results = [];

  // Fetch details for each message (up to max)
  for (const msg of messages.slice(0, Math.min(max, 5))) {
    const detail = await apiRequest(
      GMAIL_API,
      `/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date${authQuery}`,
      "GET",
      null,
      authHeader,
    );
    if (detail.status === 200) {
      const headers =
        (detail.data.payload && detail.data.payload.headers) || [];
      results.push({
        id: msg.id,
        subject:
          headers.find((h) => h.name === "Subject")?.value || "(no subject)",
        from: headers.find((h) => h.name === "From")?.value || "",
        date: headers.find((h) => h.name === "Date")?.value || "",
        snippet: detail.data.snippet || "",
      });
    }
  }

  return {
    success: true,
    action: "gmail-search",
    results,
    totalMatches: messages.length,
    result: results,
    message: `Found ${messages.length} email(s) matching "${parsed.query || "is:unread"}". Showing ${results.length}.`,
  };
}

async function handleGmailSend(parsed, creds) {
  const { to, subject, body } = parsed.params;
  if (!to) {
    return {
      success: false,
      action: "gmail-send",
      error:
        "Recipient required. Use: gmail-send to:<email> subject:<text> body:<text>",
    };
  }

  const token = await getAccessToken(creds);
  if (!token) {
    return {
      success: false,
      action: "gmail-send",
      error:
        "OAuth credentials required for sending email (API key is not sufficient).",
    };
  }

  // Build RFC 2822 message
  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject || "(no subject)"}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body || "",
  ].join("\r\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await apiRequest(
    GMAIL_API,
    "/gmail/v1/users/me/messages/send",
    "POST",
    { raw: encodedMessage },
    { Authorization: `Bearer ${token}` },
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "gmail-send",
      error: `Failed to send email (${res.status}): ${JSON.stringify(res.data)}`,
    };
  }

  return {
    success: true,
    action: "gmail-send",
    result: { messageId: res.data.id, to, subject },
    message: `Email sent to ${to} with subject "${subject}".`,
  };
}

async function handleCalendarList(parsed, creds) {
  const token = await getAccessToken(creds);
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const authQuery = !token ? `&${buildAuthQuery(creds)}` : "";

  const now = new Date();
  const future = new Date(
    now.getTime() + parsed.params.days * 24 * 60 * 60 * 1000,
  );
  const timeMin = encodeURIComponent(now.toISOString());
  const timeMax = encodeURIComponent(future.toISOString());

  const res = await apiRequest(
    CALENDAR_API,
    `/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=${parsed.params.max}&singleEvents=true&orderBy=startTime${authQuery}`,
    "GET",
    null,
    authHeader,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "calendar-list",
      error: `Calendar API error (${res.status}): ${JSON.stringify(res.data)}`,
    };
  }

  const events = (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(untitled)",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    location: e.location || "",
    status: e.status,
  }));

  return {
    success: true,
    action: "calendar-list",
    results: events,
    result: events,
    message: `Found ${events.length} event(s) in the next ${parsed.params.days} day(s).`,
  };
}

async function handleCalendarCreate(parsed, creds) {
  const token = await getAccessToken(creds);
  if (!token) {
    return {
      success: false,
      action: "calendar-create",
      error: "OAuth credentials required for creating events.",
    };
  }

  // Parse: "title" datetime --duration N
  const titleMatch = parsed.rest.match(/['"]([^'"]+)['"]/);
  const dateMatch = parsed.rest.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/);

  const title = titleMatch ? titleMatch[1] : parsed.query || "New Event";
  const startTime = dateMatch
    ? new Date(dateMatch[0])
    : new Date(Date.now() + 3600000);
  const endTime = new Date(
    startTime.getTime() + parsed.params.duration * 60000,
  );

  const event = {
    summary: title,
    start: { dateTime: startTime.toISOString() },
    end: { dateTime: endTime.toISOString() },
  };

  const res = await apiRequest(
    CALENDAR_API,
    "/calendar/v3/calendars/primary/events",
    "POST",
    event,
    { Authorization: `Bearer ${token}` },
  );

  if (res.status !== 200 && res.status !== 201) {
    return {
      success: false,
      action: "calendar-create",
      error: `Failed to create event (${res.status}): ${JSON.stringify(res.data)}`,
    };
  }

  return {
    success: true,
    action: "calendar-create",
    result: {
      eventId: res.data.id,
      summary: title,
      start: startTime.toISOString(),
      end: endTime.toISOString(),
    },
    message: `Created event "${title}" on ${startTime.toLocaleDateString()} at ${startTime.toLocaleTimeString()}.`,
  };
}

async function handleDriveList(parsed, creds) {
  const token = await getAccessToken(creds);
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  const authQuery = !token ? `&${buildAuthQuery(creds)}` : "";

  const folder = parsed.params.folder;
  const query = encodeURIComponent(`'${folder}' in parents and trashed=false`);

  const res = await apiRequest(
    DRIVE_API,
    `/drive/v3/files?q=${query}&pageSize=${parsed.params.max}&fields=files(id,name,mimeType,size,modifiedTime)${authQuery}`,
    "GET",
    null,
    authHeader,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "drive-list",
      error: `Drive API error (${res.status}): ${JSON.stringify(res.data)}`,
    };
  }

  const files = (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? parseInt(f.size, 10) : 0,
    modified: f.modifiedTime || "",
  }));

  return {
    success: true,
    action: "drive-list",
    results: files,
    result: files,
    message: `Found ${files.length} file(s) in folder "${folder}".`,
  };
}

async function handleDriveUpload(parsed, creds) {
  const token = await getAccessToken(creds);
  if (!token) {
    return {
      success: false,
      action: "drive-upload",
      error: "OAuth credentials required for uploading files.",
    };
  }

  const filePath = parsed.query;
  if (!filePath) {
    return {
      success: false,
      action: "drive-upload",
      error:
        "File path required. Usage: drive-upload <filepath> [--folder <folderId>]",
    };
  }

  const fs = require("fs");
  const path = require("path");

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      action: "drive-upload",
      error: `File not found: ${filePath}`,
    };
  }

  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;

  // Step 1: Create metadata
  const metadata = { name: fileName, parents: [parsed.params.folder] };

  const metaRes = await apiRequest(
    DRIVE_API,
    "/upload/drive/v3/files?uploadType=resumable",
    "POST",
    metadata,
    {
      Authorization: `Bearer ${token}`,
      "X-Upload-Content-Length": fileSize.toString(),
    },
  );

  if (metaRes.status !== 200 && metaRes.status !== 201) {
    return {
      success: false,
      action: "drive-upload",
      error: `Upload init failed (${metaRes.status}): ${JSON.stringify(metaRes.data)}`,
    };
  }

  return {
    success: true,
    action: "drive-upload",
    result: {
      fileName,
      fileSize,
      folder: parsed.params.folder,
      status: "upload-initiated",
    },
    message: `Upload initiated for "${fileName}" (${(fileSize / 1024).toFixed(1)} KB) to folder "${parsed.params.folder}". Complete the upload with the resumable session.`,
  };
}
