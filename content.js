(() => {
  const ROOT_ID = "cgpn-root";
  const STORAGE_KEY = "cgpn-collapsed";
  const selectors = {
    main: "main",
    article: "article",
    turn: '[data-testid^="conversation-turn-"]',
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]'
  };

  let observer = null;
  let listEl = null;
  let emptyEl = null;
  let badgeEl = null;
  let exportButtonEl = null;
  let syncScroll = false;
  let activeIndex = -1;
  let currentChatKey = null;
  let lastRenderSignature = "";
  let activeScrollJob = 0;

  function getChatKey() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts.join("/") || "root";
  }

  function getPromptText(turn) {
    const source = turn.querySelector(selectors.userMessage) || turn;
    const text = source.innerText.replace(/\s+/g, " ").trim();
    return text || "Untitled prompt";
  }

  function getTurns() {
    const main = document.querySelector(selectors.main);
    if (!main) {
      return [];
    }

    const directTurns = Array.from(main.querySelectorAll(selectors.turn))
      .filter((turn) => turn.querySelector(selectors.userMessage));

    if (directTurns.length > 0) {
      return directTurns;
    }

    return Array.from(main.querySelectorAll("div"))
      .filter((node) => node.querySelector && node.querySelector(selectors.userMessage))
      .filter((node) => {
        const assistant = node.querySelector(selectors.assistantMessage);
        const style = window.getComputedStyle(node);
        return assistant || style.position === "relative";
      });
  }

  function getMessages() {
    const main = document.querySelector(selectors.main);
    if (!main) {
      return [];
    }

    return Array.from(main.querySelectorAll(`${selectors.userMessage}, ${selectors.assistantMessage}`))
      .filter((node) => {
        const style = window.getComputedStyle(node);
        return !node.hidden && style.display !== "none" && style.visibility !== "hidden";
      });
  }

  function shorten(text, maxLength = 84) {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }

  function scrollToTurn(turn, index) {
    const jobId = ++activeScrollJob;
    syncScroll = true;
    setActiveItem(index);
    turn.scrollIntoView({ behavior: "smooth", block: "start" });
    monitorTurnSettling(turn, jobId);
  }

  function monitorTurnSettling(turn, jobId) {
    const stableFramesRequired = 3;
    const movementThreshold = 1;
    const maxCorrections = 14;
    let stableFrames = 0;
    let previousTop = null;

    function finishScroll() {
      if (jobId !== activeScrollJob) {
        return;
      }

      syncScroll = false;
      updateVisibleSelection();
    }

    let corrections = 0;

    const alignAgain = () => {
      if (jobId !== activeScrollJob || !turn.isConnected) {
        return;
      }

      turn.scrollIntoView({ behavior: "auto", block: "start" });

      const currentTop = Math.round(turn.getBoundingClientRect().top);
      const isStable = previousTop !== null && Math.abs(currentTop - previousTop) <= movementThreshold;

      if (isStable) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      previousTop = currentTop;
      corrections += 1;

      if (stableFrames >= stableFramesRequired || corrections >= maxCorrections) {
        finishScroll();
        return;
      }

      const nextDelay = corrections < 4 ? 140 : 220;
      window.setTimeout(alignAgain, nextDelay);
    };

    window.setTimeout(alignAgain, 220);
  }

  function setActiveItem(index) {
    activeIndex = index;
    const buttons = listEl ? Array.from(listEl.querySelectorAll("button")) : [];
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle("cgpn-active", buttonIndex === index);
    });
  }

  function updateExportButtonState() {
    if (!exportButtonEl) {
      return;
    }

    const hasMessages = getMessages().length > 0;
    exportButtonEl.disabled = !hasMessages;
    exportButtonEl.title = hasMessages
      ? "Download this conversation as a standalone HTML page"
      : "The conversation is still loading";
  }

  function renderList() {
    if (!listEl || !emptyEl || !badgeEl) {
      return;
    }

    const turns = getTurns();
    const promptTexts = turns.map(getPromptText);
    const nextSignature = `${currentChatKey}|${promptTexts.join("\n---\n")}`;

    if (nextSignature === lastRenderSignature) {
      badgeEl.textContent = String(turns.length);
      emptyEl.hidden = turns.length !== 0;
      updateExportButtonState();
      updateVisibleSelection();
      return;
    }

    lastRenderSignature = nextSignature;
    const previousScrollTop = listEl.scrollTop;
    badgeEl.textContent = String(turns.length);
    listEl.innerHTML = "";
    emptyEl.hidden = turns.length !== 0;

    turns.forEach((turn, index) => {
      turn.dataset.cgpnIndex = String(index);

      const item = document.createElement("li");
      item.className = "cgpn-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "cgpn-button";
      button.title = promptTexts[index];
      button.innerHTML = `
        <span class="cgpn-number">${index + 1}</span>
        <span class="cgpn-label">${escapeHtml(shorten(promptTexts[index]))}</span>
      `;
      button.addEventListener("click", () => {
        scrollToTurn(turn, index);
      });

      item.appendChild(button);
      listEl.appendChild(item);
    });

    if (activeIndex >= turns.length) {
      activeIndex = -1;
    }
    listEl.scrollTop = previousScrollTop;
    updateExportButtonState();
    updateVisibleSelection();
  }

  function updateVisibleSelection() {
    if (syncScroll || !listEl) {
      return;
    }

    const turns = getTurns();
    if (turns.length === 0) {
      setActiveItem(-1);
      return;
    }

    const viewportTop = window.innerHeight * 0.18;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    turns.forEach((turn, index) => {
      const rect = turn.getBoundingClientRect();
      const distance = Math.abs(rect.top - viewportTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    setActiveItem(bestIndex);
  }

  function escapeHtml(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span.innerHTML;
  }

  function escapeAttribute(text) {
    return escapeHtml(text).replace(/"/g, "&quot;");
  }

  function slugifyFileName(text) {
    const normalized = (text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    return normalized || "chatgpt-conversation";
  }

  function getConversationTitle(messages) {
    const cleanedTitle = document.title
      .replace(/\s*[-|]\s*ChatGPT$/i, "")
      .replace(/^ChatGPT\s*[-|]\s*/i, "")
      .trim();

    if (cleanedTitle && cleanedTitle.toLowerCase() !== "chatgpt") {
      return cleanedTitle;
    }

    const firstUserMessage = messages.find((message) => message.role === "user");
    if (firstUserMessage) {
      return shorten(firstUserMessage.text, 72).replace(/…$/, "");
    }

    return "ChatGPT conversation";
  }

  function sanitizeExportNode(node) {
    const clone = node.cloneNode(true);
    const removableSelectors = [
      "button",
      "form",
      "input",
      "select",
      "textarea",
      "script",
      "style",
      "noscript",
      "iframe",
      "canvas"
    ].join(", ");

    clone.querySelectorAll(removableSelectors).forEach((element) => element.remove());

    [clone, ...Array.from(clone.querySelectorAll("*"))].forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        const attributeName = attribute.name.toLowerCase();
        const attributeValue = attribute.value.trim();

        if (attributeName.startsWith("on")) {
          element.removeAttribute(attribute.name);
          return;
        }

        if (attributeName === "href") {
          if (/^(https?:|mailto:|#)/i.test(attributeValue)) {
            element.setAttribute("target", "_blank");
            element.setAttribute("rel", "noreferrer noopener");
          } else {
            element.removeAttribute(attribute.name);
          }
          return;
        }

        if (attributeName === "src") {
          if (!/^(https?:|data:)/i.test(attributeValue)) {
            element.removeAttribute(attribute.name);
          }
          return;
        }

        if (
          attributeName === "class" ||
          attributeName === "alt" ||
          attributeName === "title" ||
          attributeName === "colspan" ||
          attributeName === "rowspan" ||
          attributeName === "target" ||
          attributeName === "rel"
        ) {
          return;
        }

        if (attributeName.startsWith("aria-")) {
          return;
        }

        element.removeAttribute(attribute.name);
      });
    });

    if (!clone.innerHTML.trim()) {
      clone.textContent = node.innerText.trim();
    }

    return clone.innerHTML.trim();
  }

  function buildExportMessages() {
    return getMessages()
      .map((node, index) => {
        const role = node.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
        const text = node.innerText.replace(/\s+\n/g, "\n").trim();
        const html = sanitizeExportNode(node);

        if (!text && !html) {
          return null;
        }

        return {
          index,
          role,
          text,
          html
        };
      })
      .filter(Boolean);
  }

  function buildExportDocument(messages) {
    const title = getConversationTitle(messages);
    const exportedAt = new Date().toLocaleString();
    const pageTitle = escapeHtml(title);
    const conversationUrl = escapeAttribute(window.location.href);
    const conversationUrlLabel = escapeHtml(window.location.href);
    const styles = `
      :root {
        color-scheme: light dark;
        --page-bg: #f4f1ea;
        --page-text: #171717;
        --muted-text: #66614f;
        --panel-bg: rgba(255, 255, 255, 0.9);
        --panel-border: rgba(23, 23, 23, 0.1);
        --user-accent: #0f766e;
        --assistant-accent: #8b5e3c;
        --code-bg: rgba(15, 23, 42, 0.92);
        --code-text: #f8fafc;
        font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --page-bg: #111827;
          --page-text: #f3f4f6;
          --muted-text: #c1c7d0;
          --panel-bg: rgba(17, 24, 39, 0.9);
          --panel-border: rgba(255, 255, 255, 0.12);
          --user-accent: #2dd4bf;
          --assistant-accent: #fbbf24;
          --code-bg: rgba(2, 6, 23, 0.96);
          --code-text: #e5eefb;
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(16, 163, 127, 0.12), transparent 32rem),
          linear-gradient(180deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0)),
          var(--page-bg);
        color: var(--page-text);
      }

      main {
        width: min(980px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 40px 0 72px;
      }

      .page-header {
        margin-bottom: 24px;
        padding: 24px;
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        background: var(--panel-bg);
        backdrop-filter: blur(12px);
      }

      .eyebrow {
        margin: 0 0 8px;
        color: var(--muted-text);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 14px;
        font-size: clamp(2rem, 3.5vw, 3rem);
        line-height: 1.1;
      }

      .meta {
        margin: 0;
        color: var(--muted-text);
        font-size: 14px;
        line-height: 1.6;
      }

      .conversation {
        display: grid;
        gap: 16px;
      }

      .message {
        padding: 22px;
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        background: var(--panel-bg);
        backdrop-filter: blur(10px);
      }

      .message-role {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .message-user .message-role {
        background: rgba(15, 118, 110, 0.12);
        color: var(--user-accent);
      }

      .message-assistant .message-role {
        background: rgba(139, 94, 60, 0.12);
        color: var(--assistant-accent);
      }

      .message-body {
        margin-top: 14px;
        line-height: 1.7;
      }

      .message-body > :first-child {
        margin-top: 0;
      }

      .message-body > :last-child {
        margin-bottom: 0;
      }

      p,
      ul,
      ol,
      blockquote,
      pre,
      table {
        margin: 0 0 1em;
      }

      ul,
      ol {
        padding-left: 1.5em;
      }

      blockquote {
        padding-left: 16px;
        border-left: 3px solid rgba(16, 163, 127, 0.35);
        color: var(--muted-text);
      }

      pre {
        overflow: auto;
        padding: 16px;
        border-radius: 16px;
        background: var(--code-bg);
        color: var(--code-text);
        font-size: 0.92rem;
        line-height: 1.55;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      }

      :not(pre) > code {
        padding: 0.12em 0.4em;
        border-radius: 8px;
        background: rgba(148, 163, 184, 0.16);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        overflow: hidden;
        border-radius: 16px;
      }

      th,
      td {
        padding: 12px 14px;
        border: 1px solid var(--panel-border);
        text-align: left;
        vertical-align: top;
      }

      img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 16px;
      }

      a {
        color: var(--user-accent);
      }

      hr {
        border: 0;
        border-top: 1px solid var(--panel-border);
      }

      @media print {
        body {
          background: #fff;
        }

        main {
          width: 100%;
          padding: 16px 0 32px;
        }

        .page-header,
        .message {
          border-color: rgba(0, 0, 0, 0.12);
          background: #fff;
          box-shadow: none;
        }
      }
    `;

    const messageMarkup = messages
      .map((message) => {
        const roleLabel = message.role === "user" ? "You" : "ChatGPT";

        return `
          <article class="message message-${message.role}">
            <span class="message-role">${roleLabel}</span>
            <div class="message-body">${message.html}</div>
          </article>
        `;
      })
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <style>${styles}</style>
  </head>
  <body>
    <main>
      <header class="page-header">
        <p class="eyebrow">ChatGPT Export</p>
        <h1>${pageTitle}</h1>
        <p class="meta">Exported ${escapeHtml(exportedAt)}</p>
        <p class="meta">Source: <a href="${conversationUrl}">${conversationUrlLabel}</a></p>
        <p class="meta">${messages.length} messages saved</p>
      </header>
      <section class="conversation">
        ${messageMarkup}
      </section>
    </main>
  </body>
</html>`;
  }

  function triggerHtmlDownload(fileName, html) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function saveHtmlWithPicker(fileName, html) {
    if (typeof window.showSaveFilePicker !== "function") {
      return false;
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "HTML page",
          accept: {
            "text/html": [".html", ".htm"]
          }
        }
      ]
    });
    const writable = await handle.createWritable();

    await writable.write(html);
    await writable.close();
    return true;
  }

  async function downloadConversationAsHtml() {
    const messages = buildExportMessages();
    if (messages.length === 0) {
      updateExportButtonState();
      return;
    }

    if (exportButtonEl) {
      exportButtonEl.disabled = true;
    }

    try {
      const title = getConversationTitle(messages);
      const html = buildExportDocument(messages);
      const fileName = `${slugifyFileName(title)}.html`;
      let savedWithPicker = false;

      try {
        savedWithPicker = await saveHtmlWithPicker(fileName, html);
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }

        console.warn("ChatGPT Prompt Navigator save picker unavailable, falling back to download", error);
      }

      if (!savedWithPicker) {
        triggerHtmlDownload(fileName, html);
      }
    } catch (error) {
      console.error("ChatGPT Prompt Navigator export failed", error);
    } finally {
      updateExportButtonState();
    }
  }

  function createRoot() {
    const nextChatKey = getChatKey();
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot && currentChatKey === nextChatKey) {
      return;
    }

    if (existingRoot) {
      existingRoot.remove();
      listEl = null;
      emptyEl = null;
      badgeEl = null;
      exportButtonEl = null;
      activeIndex = -1;
    }

    currentChatKey = nextChatKey;
    lastRenderSignature = "";
    activeScrollJob = 0;

    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="cgpn-shell">
        <button type="button" class="cgpn-toggle" aria-expanded="true" aria-controls="cgpn-panel">
          <span class="cgpn-toggle-label">Prompts</span>
          <span class="cgpn-badge">0</span>
        </button>
        <section class="cgpn-panel" id="cgpn-panel">
          <div class="cgpn-header">
            <div>
              <p class="cgpn-eyebrow">ChatGPT</p>
              <h2 class="cgpn-title">Prompt Navigator</h2>
            </div>
            <div class="cgpn-actions">
              <button type="button" class="cgpn-export" aria-label="Download conversation as HTML">Download HTML</button>
              <button type="button" class="cgpn-collapse" aria-label="Collapse sidebar">Hide</button>
            </div>
          </div>
          <p class="cgpn-empty">Your prompts will appear here as the conversation loads.</p>
          <ol class="cgpn-list"></ol>
        </section>
      </div>
    `;

    document.body.appendChild(root);

    listEl = root.querySelector(".cgpn-list");
    emptyEl = root.querySelector(".cgpn-empty");
    badgeEl = root.querySelector(".cgpn-badge");
    exportButtonEl = root.querySelector(".cgpn-export");

    const toggle = root.querySelector(".cgpn-toggle");
    const collapse = root.querySelector(".cgpn-collapse");
    const shell = root.querySelector(".cgpn-shell");
    const collapsed = window.localStorage.getItem(`${STORAGE_KEY}:${currentChatKey}`) === "1";

    function applyCollapsed(nextCollapsed) {
      shell.classList.toggle("cgpn-collapsed", nextCollapsed);
      toggle.setAttribute("aria-expanded", String(!nextCollapsed));
      window.localStorage.setItem(`${STORAGE_KEY}:${currentChatKey}`, nextCollapsed ? "1" : "0");
    }

    toggle.addEventListener("click", () => {
      applyCollapsed(!shell.classList.contains("cgpn-collapsed"));
    });
    collapse.addEventListener("click", () => applyCollapsed(true));
    exportButtonEl.addEventListener("click", downloadConversationAsHtml);

    applyCollapsed(collapsed);
    updateExportButtonState();
  }

  function scheduleRender() {
    window.requestAnimationFrame(() => {
      createRoot();
      renderList();
    });
  }

  function attachObserver() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(() => {
      scheduleRender();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    createRoot();
    renderList();
    attachObserver();
    window.addEventListener("scroll", updateVisibleSelection, { passive: true });
    window.addEventListener("resize", updateVisibleSelection, { passive: true });
    window.addEventListener("popstate", scheduleRender);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
