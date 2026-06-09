import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import http from "http";
import { EventEmitter } from "events";
import {
  webSearch,
  resolveProvider,
  resolveApiKey,
  SUPPORTED_PROVIDERS,
  _deps,
} from "../../src/lib/web-search.js";

// Build a fake http(s) lib whose request() resolves a canned response keyed by
// the request hostname. Mirrors the node http.request(opts, cb) contract.
function makeFakeLib(responder) {
  return {
    request(opts, cb) {
      let writtenBody = "";
      const res = new EventEmitter();
      const req = new EventEmitter();
      req.write = (b) => {
        writtenBody += b;
      };
      req.destroy = () => {};
      req.end = () => {
        const { statusCode, body } = responder({ ...opts, body: writtenBody });
        setImmediate(() => {
          cb(res);
          res.emit("data", Buffer.from(String(body), "utf8"));
          res.emit("end");
        });
      };
      return req;
    },
  };
}

const TAVILY_BODY = JSON.stringify({
  answer: "Synthesized answer.",
  results: [
    { title: "T1", url: "https://a.com/1", content: "first <b>result</b>" },
    { title: "T2", url: "https://a.com/2", content: "second result" },
  ],
});
const BRAVE_BODY = JSON.stringify({
  web: {
    results: [
      { title: "B1", url: "https://b.com/1", description: "brave one" },
      { title: "B2", url: "https://b.com/2", description: "brave two" },
    ],
  },
});
const BOCHA_BODY = JSON.stringify({
  data: {
    webPages: {
      value: [
        { name: "C1", url: "https://c.com/1", summary: "bocha sum" },
        { name: "C2", url: "https://c.com/2", snippet: "bocha snip" },
      ],
    },
  },
});
const QIANFAN_BODY = JSON.stringify({
  request_id: "r1",
  references: [
    { id: 1, title: "千帆 Q1", url: "https://q.com/1", content: "qianfan 摘要一", web_anchor: "Q1" },
    { id: 2, title: "千帆 Q2", url: "https://q.com/2", web_anchor: "qianfan 锚二" },
  ],
});
const DDG_BODY = `
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=x">Example <b>Title</b></a>
    <a class="result__snippet" href="x">A <b>snippet</b> text</a>
  </div>`;

const BAIDU_BODY = `
  <div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=ABC">百度百科 <em>测试</em></a></h3>
    <div class="c-abstract">这是第一条摘要文本。</div>
  </div>
  <div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=DEF">第二条标题</a></h3>
    <div>第二条摘要。</div>
  </div>`;
const BAIDU_CAPTCHA_BODY =
  '<a href="https://wappass.baidu.com/static/captcha/tuxing_v2.html?logid=1">跳转</a>';

function defaultResponder({ hostname }) {
  switch (hostname) {
    case "api.tavily.com":
      return { statusCode: 200, body: TAVILY_BODY };
    case "api.search.brave.com":
      return { statusCode: 200, body: BRAVE_BODY };
    case "api.bochaai.com":
      return { statusCode: 200, body: BOCHA_BODY };
    case "qianfan.baidubce.com":
      return { statusCode: 200, body: QIANFAN_BODY };
    case "html.duckduckgo.com":
      return { statusCode: 200, body: DDG_BODY };
    case "www.baidu.com":
      return { statusCode: 200, body: BAIDU_BODY };
    default:
      return { statusCode: 404, body: "" };
  }
}

describe("web-search — resolveApiKey()", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers options.apiKey, then config, then env", () => {
    expect(
      resolveApiKey("tavily", { apiKey: "opt" }, { tavilyApiKey: "cfg" }),
    ).toBe("opt");
    expect(resolveApiKey("tavily", {}, { tavilyApiKey: "cfg" })).toBe("cfg");
    process.env.TAVILY_API_KEY = "env";
    expect(resolveApiKey("tavily", {}, {})).toBe("env");
  });

  it("reads both BRAVE_API_KEY and BRAVE_SEARCH_API_KEY", () => {
    delete process.env.BRAVE_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "bs";
    expect(resolveApiKey("brave", {}, {})).toBe("bs");
  });

  it("returns empty string for keyless providers", () => {
    expect(resolveApiKey("duckduckgo", {}, {})).toBe("");
  });
});

describe("web-search — resolveProvider()", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("honors an explicit non-auto provider", () => {
    expect(resolveProvider({ provider: "brave" }, {})).toBe("brave");
  });

  it("auto-selects the first keyed provider with a key (tavily > brave > bocha)", () => {
    expect(resolveProvider({ provider: "auto" }, { braveApiKey: "x" })).toBe(
      "brave",
    );
    expect(
      resolveProvider(
        { provider: "auto" },
        { tavilyApiKey: "t", braveApiKey: "b" },
      ),
    ).toBe("tavily");
  });

  it("falls back to keyless duckduckgo when no key is configured", () => {
    for (const k of [
      "TAVILY_API_KEY",
      "BRAVE_API_KEY",
      "BRAVE_SEARCH_API_KEY",
      "BOCHA_API_KEY",
    ]) {
      delete process.env[k];
    }
    expect(resolveProvider({}, {})).toBe("duckduckgo");
  });
});

describe("web-search — webSearch() provider parsing", () => {
  let realHttps;
  beforeEach(() => {
    realHttps = _deps.https;
    _deps.https = makeFakeLib(defaultResponder);
  });
  afterEach(() => {
    _deps.https = realHttps;
  });

  it("rejects an empty query", async () => {
    expect((await webSearch("   ")).error).toMatch(/empty query/);
  });

  it("rejects an unsupported provider", async () => {
    const r = await webSearch("q", { provider: "bing" });
    expect(r.error).toMatch(/unsupported provider/);
  });

  it("parses Tavily results + answer", async () => {
    const r = await webSearch("hi", { provider: "tavily", apiKey: "k" });
    expect(r.provider).toBe("tavily");
    expect(r.answer).toBe("Synthesized answer.");
    expect(r.count).toBe(2);
    expect(r.results[0]).toEqual({
      title: "T1",
      url: "https://a.com/1",
      snippet: "first result",
    });
  });

  it("errors when a keyed provider has no key", async () => {
    const r = await webSearch("hi", { provider: "tavily" });
    expect(r.error).toMatch(/missing API key/);
    expect(r.provider).toBe("tavily");
  });

  it("parses Brave results", async () => {
    const r = await webSearch("hi", { provider: "brave", apiKey: "k" });
    expect(r.provider).toBe("brave");
    expect(r.results.map((x) => x.url)).toEqual([
      "https://b.com/1",
      "https://b.com/2",
    ]);
  });

  it("parses Bocha (Bing-style) results", async () => {
    const r = await webSearch("hi", { provider: "bocha", apiKey: "k" });
    expect(r.provider).toBe("bocha");
    expect(r.results[0].snippet).toBe("bocha sum");
    expect(r.results[1].snippet).toBe("bocha snip");
  });

  it("parses DuckDuckGo HTML and decodes the uddg redirect", async () => {
    const r = await webSearch("hi", { provider: "duckduckgo" });
    expect(r.provider).toBe("duckduckgo");
    expect(r.count).toBe(1);
    expect(r.results[0].url).toBe("https://example.com/page");
    expect(r.results[0].title).toBe("Example Title");
    expect(r.results[0].snippet).toBe("A snippet text");
  });

  it("parses Qianfan AI Search references", async () => {
    const r = await webSearch("hi", { provider: "qianfan", apiKey: "k" });
    expect(r.provider).toBe("qianfan");
    expect(r.count).toBe(2);
    expect(r.results[0]).toEqual({
      title: "千帆 Q1",
      url: "https://q.com/1",
      snippet: "qianfan 摘要一",
    });
    // 2nd ref has no content → falls back to web_anchor for the snippet
    expect(r.results[1].snippet).toBe("qianfan 锚二");
  });

  it("errors when qianfan has no key", async () => {
    const r = await webSearch("hi", { provider: "qianfan" });
    expect(r.error).toMatch(/missing API key/);
    expect(r.provider).toBe("qianfan");
  });

  it("parses Baidu HTML (title/url/snippet) keyless", async () => {
    const r = await webSearch("测试", { provider: "baidu" });
    expect(r.provider).toBe("baidu");
    expect(r.count).toBe(2);
    expect(r.results[0].title).toBe("百度百科 测试");
    expect(r.results[0].url).toBe("http://www.baidu.com/link?url=ABC");
    expect(r.results[0].snippet).toContain("第一条摘要");
    expect(r.results[1].url).toBe("http://www.baidu.com/link?url=DEF");
  });

  it("reports a clear error when Baidu returns a captcha/redirect", async () => {
    _deps.https = makeFakeLib(({ hostname }) =>
      hostname === "www.baidu.com"
        ? { statusCode: 302, body: BAIDU_CAPTCHA_BODY }
        : { statusCode: 404, body: "" },
    );
    const r = await webSearch("测试", { provider: "baidu" });
    expect(r.provider).toBe("baidu");
    expect(r.error).toMatch(/rate-limited \/ captcha/);
  });

  it("respects maxResults", async () => {
    const r = await webSearch("hi", {
      provider: "tavily",
      apiKey: "k",
      maxResults: 1,
    });
    expect(r.count).toBe(1);
  });

  it("exposes the supported provider list", () => {
    expect(SUPPORTED_PROVIDERS).toContain("tavily");
    expect(SUPPORTED_PROVIDERS).toContain("duckduckgo");
    expect(SUPPORTED_PROVIDERS).toContain("searxng");
  });
});

describe("web-search — searxng against a local JSON server", () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith("/search")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              { title: "S1", url: "https://s.com/1", content: "searxng one" },
            ],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("queries a configured instanceUrl and normalizes results", async () => {
    const r = await webSearch("hi", {
      provider: "searxng",
      instanceUrl: `http://127.0.0.1:${port}`,
    });
    expect(r.provider).toBe("searxng");
    expect(r.results[0]).toEqual({
      title: "S1",
      url: "https://s.com/1",
      snippet: "searxng one",
    });
  });

  it("errors when searxng has no instanceUrl", async () => {
    const r = await webSearch("hi", { provider: "searxng" });
    expect(r.error).toMatch(/missing instanceUrl/);
  });
});
