import { describe, expect, it } from "vitest";

const {
  domainAllowed,
  isForbiddenAddress,
  validateMcpEgress,
} = require("../../../src/main/mcp/mcp-egress-policy");

function lookupWith(address) {
  return (_hostname, _options, callback) =>
    callback(null, [{ address, family: address.includes(":") ? 6 : 4 }]);
}

describe("MCP egress policy", () => {
  it("recognizes exact and wildcard domain capabilities", () => {
    expect(domainAllowed("api.example.com", ["api.example.com"])).toBe(true);
    expect(domainAllowed("a.example.com", ["*.example.com"])).toBe(true);
    expect(domainAllowed("example.com", ["*.example.com"])).toBe(false);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("denies local/private address %s", (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it("allows an explicitly listed public HTTPS endpoint", async () => {
    const result = await validateMcpEgress(
      {
        baseURL: "https://mcp.example.com",
        permissions: { allowedDomains: ["mcp.example.com"] },
      },
      { lookup: lookupWith("203.0.113.10") },
    );
    expect(result.url.hostname).toBe("mcp.example.com");
    expect(result.lookup).toEqual(expect.any(Function));
  });

  it("fails closed for missing domain capability and private DNS answers", async () => {
    await expect(
      validateMcpEgress(
        { baseURL: "https://mcp.example.com", permissions: {} },
        { lookup: lookupWith("203.0.113.10") },
      ),
    ).rejects.toMatchObject({ code: "MCP_EGRESS_DOMAIN_DENIED" });
    await expect(
      validateMcpEgress(
        {
          baseURL: "https://mcp.example.com",
          permissions: { allowedDomains: ["mcp.example.com"] },
        },
        { lookup: lookupWith("127.0.0.1") },
      ),
    ).rejects.toMatchObject({ code: "MCP_EGRESS_ADDRESS_DENIED" });
  });
});
