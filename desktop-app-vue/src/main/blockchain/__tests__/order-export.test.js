import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// puppeteer is not installed in this environment; the module now guards that
// require, so it loads fine and the exporters degrade to { success:false }.
import {
  generateOrderHTML,
  exportOrderToPDF,
  exportOrderToImage,
} from "../order-export.js";

const baseOrder = {
  id: "ord-1",
  status: "open",
  type: "sell",
  assetType: "NFT",
  quantity: 3,
  price: 12.5,
  currency: "CNY",
  creatorDid: "did:cc:alice",
};

describe("generateOrderHTML escaping (XSS regression)", () => {
  it("escapes HTML/script in the free-text description", () => {
    const html = generateOrderHTML({
      ...baseOrder,
      description: '<script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes an img/onerror payload in the description", () => {
    const html = generateOrderHTML({
      ...baseOrder,
      description: '<img src=x onerror="steal()">',
    });
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain("&lt;img src=x onerror=");
  });

  it("escapes injection in id, assetType and DID fields", () => {
    const html = generateOrderHTML({
      ...baseOrder,
      id: '"><b>x</b>',
      assetType: "<i>nft</i>",
      creatorDid: "<u>did</u>",
      buyerDid: "<s>buyer</s>",
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>nft</i>");
    expect(html).not.toContain("<u>did</u>");
    expect(html).not.toContain("<s>buyer</s>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("escapes an unmapped status and the currency in the price", () => {
    const html = generateOrderHTML({
      ...baseOrder,
      status: "<x>",
      currency: "<y>",
    });
    expect(html).not.toContain("<x>");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("&lt;y&gt;");
  });
});

describe("generateOrderHTML rendering", () => {
  it("maps known status/type codes to Chinese labels", () => {
    const html = generateOrderHTML(baseOrder);
    expect(html).toContain("开放中"); // status open
    expect(html).toContain("出售"); // type sell
    expect(html).toContain("12.50 CNY");
    expect(html).toContain("ord-1");
  });

  it("omits the description and buyer sections when absent", () => {
    const html = generateOrderHTML(baseOrder);
    expect(html).not.toContain("订单描述");
    expect(html).not.toContain("买家 DID");
  });

  it("renders the description and buyer sections when present", () => {
    const html = generateOrderHTML({
      ...baseOrder,
      description: "plain text",
      buyerDid: "did:cc:bob",
    });
    expect(html).toContain("订单描述");
    expect(html).toContain("plain text");
    expect(html).toContain("买家 DID");
    expect(html).toContain("did:cc:bob");
  });

  it("falls back to '-' for missing fields", () => {
    const html = generateOrderHTML({ id: "x" });
    // price/quantity/assetType absent -> placeholder
    expect(html).toContain("-");
    expect(html).toContain("订单号: x");
  });
});

describe("exporters degrade gracefully without puppeteer/sharp", () => {
  it("exportOrderToPDF returns a failure result instead of throwing", async () => {
    const res = await exportOrderToPDF(baseOrder);
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  it("exportOrderToImage returns a failure result instead of throwing", async () => {
    const res = await exportOrderToImage(baseOrder);
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
  });
});
