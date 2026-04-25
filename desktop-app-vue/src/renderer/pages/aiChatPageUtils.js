import { nextTick } from "vue";
import { marked } from "marked";
import { logger } from "@/utils/logger";

marked.setOptions({
  highlight: function (code) {
    return code;
  },
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();

renderer.code = function (code, language) {
  const escapedCode = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return `<div class="code-block-wrapper" data-language="${language || ""}" data-code="${escapedCode}">
    <div class="code-block-placeholder">
      <pre><code class="language-${language || "plaintext"}">${escapedCode}</code></pre>
    </div>
  </div>`;
};

marked.use({ renderer });

export const renderMarkdown = (content) => {
  if (!content) {
    return "";
  }

  try {
    return marked.parse(content);
  } catch (error) {
    logger.error("Markdown 渲染失败:", error);
    const div = document.createElement("div");
    div.textContent = content;
    return div.innerHTML;
  }
};

export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const enhanceCodeBlocks = () => {
  nextTick(() => {
    const codeBlocks = document.querySelectorAll(".code-block-wrapper");

    codeBlocks.forEach((wrapper) => {
      if (wrapper.querySelector(".code-copy-btn")) {
        return;
      }

      const code = wrapper.getAttribute("data-code");
      if (!code) {
        return;
      }

      const copyBtn = document.createElement("button");
      copyBtn.className = "code-copy-btn";
      copyBtn.textContent = "复制";
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          const decodedCode = code
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

          await navigator.clipboard.writeText(decodedCode);
          copyBtn.textContent = "✓ 已复制";
          setTimeout(() => {
            copyBtn.textContent = "复制";
          }, 2000);
        } catch (err) {
          logger.error("复制失败:", err);
          copyBtn.textContent = "✗ 失败";
          setTimeout(() => {
            copyBtn.textContent = "复制";
          }, 2000);
        }
      };

      wrapper.appendChild(copyBtn);
    });
  });
};
