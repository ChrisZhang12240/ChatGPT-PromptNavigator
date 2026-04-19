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
            <button type="button" class="cgpn-collapse" aria-label="Collapse sidebar">Hide</button>
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

    applyCollapsed(collapsed);
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
