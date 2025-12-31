// virtualization.js
(function initializeVirtualizationModule() {
  const scroller = window.ChatGPTVirtualScroller;
  const config = scroller.config;
  const state = scroller.state;
  const log = scroller.log;

  // ---------------------------------------------------------------------------
  // Small activation badge
  // ---------------------------------------------------------------------------

  const BADGE_ATTRIBUTE = "data-chatgpt-virtual-scroller-badge";

  // Tracks whether we've already shown the activation badge for this chat
  let hasShownBadgeForCurrentChat = false;

  /**
   * Show a small fancy badge near the chat input for ~2 seconds.
   * Used to indicate that virtualization is active for this chat.
   */
  function showActiveBadge() {
    // Remove previous badge if any
    const existingBadge = document.querySelector(`[${BADGE_ATTRIBUTE}]`);
    if (existingBadge) existingBadge.remove();

    const badge = document.createElement("div");
    badge.setAttribute(BADGE_ATTRIBUTE, "1");

    // Little icon + text
    badge.innerHTML = `<span style="margin-right:4px">⚡</span><span>Lag Fixer active</span>`;

    Object.assign(badge.style, {
      position: "fixed",
      right: "50px",
      bottom: "50px", // roughly above the input bar
      zIndex: "9999",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "4px",

      // Fancy pill look
      padding: "5px 12px",
      borderRadius: "999px",
      fontSize: "16px",
      fontWeight: "500",
      color: "#ffffff",
      background:
        "linear-gradient(135deg, rgba(108,92,231,0.92), rgba(142,68,173,0.96))",
      boxShadow: "0 6px 18px rgba(15, 23, 42, 0.35)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",

      pointerEvents: "none",
      opacity: "0",
      transform: "translateY(6px) scale(0.98)",
      transition:
        "opacity 180ms ease-out, transform 180ms ease-out, filter 180ms ease-out"
    });

    document.body.appendChild(badge);

    // Fade in on the next frame
    requestAnimationFrame(() => {
      badge.style.opacity = "1";
      badge.style.transform = "translateY(0) scale(1)";
    });

    // After 2 seconds, fade out and remove
    setTimeout(() => {
      badge.style.opacity = "0";
      badge.style.transform = "translateY(6px) scale(0.98)";
      setTimeout(() => badge.remove(), 250);
    }, 5000);
  }

  // ---------------------------------------------------------------------------
  // Selectors
  // ---------------------------------------------------------------------------

  /**
   * Find the main conversation root element.
   *
   * @returns {HTMLElement}
   */
  function findConversationRoot() {
    const selectors = [
      'main[class*="conversation" i]',
      '[role="main"]',
      "main",
      '[class*="thread" i]',
      '[class*="conversation" i]'
    ];

    for (const selector of selectors) {
      const root = document.querySelector(selector);
      if (root instanceof HTMLElement) {
        log("Found conversation root via selector:", selector);
        return root;
      }
    }

    log("Conversation root not found via selectors; using <body>");
    return document.body;
  }

  /** @returns {boolean} */
  function hasAnyMessages() {
    return !!document.querySelector(config.ARTICLE_SELECTOR);
  }

  /**
   * Find the scrollable container for the conversation.
   *
   * @returns {HTMLElement | Window}
   */
  function findScrollContainer() {
    const firstMessage = document.querySelector(config.ARTICLE_SELECTOR);

    if (firstMessage instanceof HTMLElement) {
      let ancestor = firstMessage.parentElement;
      while (
        ancestor &&
        ancestor !== document.body &&
        ancestor !== document.documentElement
      ) {
        const styles = getComputedStyle(ancestor);
        const overflowY = styles.overflowY;
        const isScrollable =
          (overflowY === "auto" || overflowY === "scroll") &&
          ancestor.scrollHeight > ancestor.clientHeight + 10;

        if (isScrollable) {
          log(
            "Found scroll container from ancestor:",
            ancestor.tagName,
            ancestor.className
          );
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
    }

    if (state.conversationRoot) {
      if (
        state.conversationRoot.scrollHeight >
        state.conversationRoot.clientHeight + 10
      ) {
        log("Using conversation root as scroll container");
        return state.conversationRoot;
      }
    }

    const docScroll =
      document.scrollingElement || document.documentElement || document.body;

    log("Using document.scrollingElement as scroll container");
    return docScroll;
  }

  // ---------------------------------------------------------------------------
  // Streaming detection helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect if ChatGPT is currently streaming a response.
   * Uses multiple heuristics to robustly detect streaming state.
   *
   * @returns {boolean}
   */
  function detectStreamingState() {
    // Method 1: Check for "Stop generating" button
    const stopButton = document.querySelector(
      'button[aria-label*="Stop" i], button[data-testid*="stop" i], button:has(svg[data-icon="stop"])'
    );
    if (stopButton && stopButton.offsetParent !== null) {
      log("Streaming detected: Stop button found");
      return true;
    }

    // Method 2: Check for buttons with "Stop" text content
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent || '';
      if (text.toLowerCase().includes('stop') && 
          (text.toLowerCase().includes('generat') || text.toLowerCase().includes('streaming'))) {
        if (btn.offsetParent !== null) {
          log("Streaming detected: Stop generating button found");
          return true;
        }
      }
    }

    // Method 3: Check for streaming cursor/indicator in the last message
    const messages = document.querySelectorAll(config.ARTICLE_SELECTOR);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      
      // Look for common streaming indicators
      const streamingIndicators = [
        '[class*="cursor"]',
        '[class*="streaming"]',
        '[class*="typing"]',
        '[data-streaming="true"]',
        '.result-streaming'
      ];
      
      for (const selector of streamingIndicators) {
        if (lastMessage.querySelector(selector)) {
          log("Streaming detected: Streaming indicator found");
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the currently streaming message element, if any.
   *
   * @returns {HTMLElement | null}
   */
  function getStreamingMessageElement() {
    const messages = document.querySelectorAll(config.ARTICLE_SELECTOR);
    if (messages.length === 0) return null;

    // The streaming message is typically the last assistant message
    const lastMessage = messages[messages.length - 1];
    
    // Verify it's an assistant message (usually even-numbered turns, or check for assistant markers)
    const isAssistant = lastMessage.querySelector('[data-message-author-role="assistant"]') ||
                        lastMessage.getAttribute('data-testid')?.includes('-') ||
                        true; // fallback: treat last message as streaming candidate

    if (isAssistant && lastMessage instanceof HTMLElement) {
      return lastMessage;
    }

    return null;
  }

  /**
   * Get messages that should be pinned during streaming.
   * Returns virtual IDs of messages that must remain mounted.
   *
   * @returns {Set<string>}
   */
  function getPinnedMessageIds() {
    const pinnedIds = new Set();
    
    if (!state.isStreaming) {
      return pinnedIds;
    }

    const messages = document.querySelectorAll(
      `${config.ARTICLE_SELECTOR}, div[data-chatgpt-virtual-spacer="1"]`
    );
    
    if (messages.length === 0) return pinnedIds;

    // Find indices of messages to pin
    const totalMessages = messages.length;
    const bufferCount = config.STREAMING_BUFFER_MESSAGES;
    
    // Pin the last N messages (streaming message + preceding context)
    const pinStartIndex = Math.max(0, totalMessages - bufferCount - 1);
    
    for (let i = pinStartIndex; i < totalMessages; i++) {
      const msg = messages[i];
      if (msg instanceof HTMLElement && msg.dataset.virtualId) {
        pinnedIds.add(msg.dataset.virtualId);
      }
    }

    log(`Pinning ${pinnedIds.size} messages during streaming`);
    return pinnedIds;
  }

  /**
   * Update streaming state and pinned messages.
   */
  function updateStreamingState() {
    const wasStreaming = state.isStreaming;
    state.isStreaming = detectStreamingState();
    
    if (state.isStreaming !== wasStreaming) {
      log(`Streaming state changed: ${wasStreaming} → ${state.isStreaming}`);
    }

    if (state.isStreaming) {
      state.pinnedMessageIds = getPinnedMessageIds();
      
      // Track the streaming message for resize observation
      const streamingMsg = getStreamingMessageElement();
      if (streamingMsg !== state.currentStreamingMessage) {
        // Update resize observer target
        if (state.resizeObserver && state.currentStreamingMessage) {
          state.resizeObserver.unobserve(state.currentStreamingMessage);
        }
        state.currentStreamingMessage = streamingMsg;
        if (state.resizeObserver && streamingMsg) {
          state.resizeObserver.observe(streamingMsg);
        }
      }
    } else {
      state.pinnedMessageIds.clear();
      if (state.resizeObserver && state.currentStreamingMessage) {
        state.resizeObserver.unobserve(state.currentStreamingMessage);
      }
      state.currentStreamingMessage = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll position helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the user is at or near the bottom of the scroll container.
   *
   * @returns {boolean}
   */
  function checkIsUserAtBottom() {
    const scrollEl = state.scrollElement;
    if (!scrollEl) return true;

    let scrollTop, scrollHeight, clientHeight;

    if (scrollEl === window || scrollEl === document.documentElement || scrollEl === document.body) {
      scrollTop = window.scrollY || document.documentElement.scrollTop;
      scrollHeight = document.documentElement.scrollHeight;
      clientHeight = window.innerHeight;
    } else if (scrollEl instanceof HTMLElement) {
      scrollTop = scrollEl.scrollTop;
      scrollHeight = scrollEl.scrollHeight;
      clientHeight = scrollEl.clientHeight;
    } else {
      return true;
    }

    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    return distanceFromBottom < config.BOTTOM_THRESHOLD_PX;
  }

  /**
   * Scroll to bottom of the container if user was at bottom.
   */
  function maintainBottomAnchor() {
    if (!state.isUserAtBottom || !state.scrollElement) return;

    const scrollEl = state.scrollElement;

    if (scrollEl === window || scrollEl === document.documentElement || scrollEl === document.body) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    } else if (scrollEl instanceof HTMLElement) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // Core virtualization helpers
  // ---------------------------------------------------------------------------

  /**
   * Assign virtual IDs to visible <article> messages.
   */
  function ensureVirtualIds() {
    const articleList = document.querySelectorAll(config.ARTICLE_SELECTOR);

    articleList.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      if (!node.dataset.virtualId) {
        const newId = String(state.nextVirtualId++);
        node.dataset.virtualId = newId;
        state.articleMap.set(newId, node);
      } else {
        const id = node.dataset.virtualId;
        if (id && !state.articleMap.has(id)) {
          state.articleMap.set(id, node);
        }
      }
    });
  }

  /**
   * Get viewport position/height for the scroll container.
   */
  function getViewportMetrics() {
    const scrollElement = state.scrollElement;

    if (
      scrollElement &&
      scrollElement !== document.body &&
      scrollElement !== document.documentElement &&
      scrollElement !== window &&
      scrollElement instanceof HTMLElement
    ) {
      const rect = scrollElement.getBoundingClientRect();
      return { top: rect.top, height: scrollElement.clientHeight };
    }

    return { top: 0, height: window.innerHeight };
  }

  function convertArticleToSpacer(articleElement) {
    const id = articleElement.dataset.virtualId;
    if (!id || !articleElement.isConnected) return;

    // Never unmount pinned messages
    if (state.pinnedMessageIds.has(id)) {
      log(`Skipping virtualization of pinned message: ${id}`);
      return;
    }

    const rect = articleElement.getBoundingClientRect();
    const height = rect.height || 24;

    const spacer = document.createElement("div");
    spacer.dataset.chatgptVirtualSpacer = "1";
    spacer.dataset.virtualId = id;
    spacer.style.height = `${height}px`;
    spacer.style.pointerEvents = "none";
    spacer.style.opacity = "0";

    articleElement.replaceWith(spacer);
    state.articleMap.set(id, articleElement);
  }

  function convertSpacerToArticle(spacerElement) {
    const id = spacerElement.dataset.virtualId;
    if (!id) return;

    const original = state.articleMap.get(id);
    if (!original || original.isConnected) return;

    spacerElement.replaceWith(original);
  }

  function updateStats() {
    const nodes = document.querySelectorAll(
      `${config.ARTICLE_SELECTOR}, div[data-chatgpt-virtual-spacer="1"]`
    );

    let total = 0;
    let rendered = 0;

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (!node.dataset.virtualId) return;

      total += 1;
      if (node.tagName === "ARTICLE") rendered += 1;
    });

    state.stats.totalMessages = total;
    state.stats.renderedMessages = rendered;
  }

  /**
   * Core virtualization pass - runs the actual virtualization logic.
   *
   * @param {string} reason - Reason for this virtualization run (for debugging)
   */
  function runVirtualize(reason) {
    if (!state.enabled) return;

    state.lastVirtualizeTime = performance.now();
    
    // Update streaming state before virtualization
    updateStreamingState();
    
    // Track scroll position before changes
    const wasAtBottom = checkIsUserAtBottom();
    state.isUserAtBottom = wasAtBottom;

    ensureVirtualIds();

    const nodes = document.querySelectorAll(
      `${config.ARTICLE_SELECTOR}, div[data-chatgpt-virtual-spacer="1"]`
    );
    if (!nodes.length) {
      log("virtualize: no messages yet");
      return;
    }

    const viewport = getViewportMetrics();

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const id = node.dataset.virtualId;
      
      // Skip pinned messages entirely
      if (id && state.pinnedMessageIds.has(id)) {
        // If it's a spacer, restore it
        if (node.dataset.chatgptVirtualSpacer === "1") {
          convertSpacerToArticle(node);
        }
        return;
      }

      const rect = node.getBoundingClientRect();
      const relativeTop = rect.top - viewport.top;
      const relativeBottom = rect.bottom - viewport.top;

      const isOutside =
        relativeBottom < -config.MARGIN_PX ||
        relativeTop > viewport.height + config.MARGIN_PX;

      if (node.tagName === "ARTICLE") {
        if (isOutside) convertArticleToSpacer(node);
      } else if (node.dataset.chatgptVirtualSpacer === "1") {
        if (!isOutside) convertSpacerToArticle(node);
      }
    });

    updateStats();
    
    // Maintain bottom anchor if user was at bottom
    if (wasAtBottom && state.isStreaming) {
      maintainBottomAnchor();
    }
    
    log(
      `virtualize (${reason}): total=${state.stats.totalMessages}, rendered=${state.stats.renderedMessages}, streaming=${state.isStreaming}, pinned=${state.pinnedMessageIds.size}`
    );

    // Show activation badge only once per chat,
    // and only after we know there are messages and virtualization has run.
    if (
      !hasShownBadgeForCurrentChat &&
      state.stats.totalMessages > 0
    ) {
      hasShownBadgeForCurrentChat = true;
      showActiveBadge();
    }
  }

  /**
   * Schedule a virtualization run with throttling.
   * Uses requestAnimationFrame + time-based throttling during streaming.
   *
   * @param {string} reason - Reason for scheduling (for debugging)
   */
  function scheduleVirtualization(reason = "unknown") {
    if (state.virtualizePending) return;
    state.virtualizePending = true;

    requestAnimationFrame(() => {
      state.virtualizePending = false;
      
      const now = performance.now();
      const timeSinceLastRun = now - state.lastVirtualizeTime;
      
      // During streaming, enforce stricter throttling to avoid thrashing
      const throttleMs = state.isStreaming ? config.STREAMING_THROTTLE_MS : 0;
      
      if (timeSinceLastRun < throttleMs) {
        // Schedule for later
        setTimeout(() => {
          runVirtualize(reason);
        }, throttleMs - timeSinceLastRun);
        return;
      }
      
      runVirtualize(reason);
    });
  }

  // Legacy function for backwards compatibility
  function virtualizeNow() {
    runVirtualize("direct");
  }

  function getStatsSnapshot() {
    const { totalMessages, renderedMessages } = state.stats;
    const saved =
      totalMessages > 0
        ? Math.round((1 - renderedMessages / totalMessages) * 100)
        : 0;

    return {
      totalMessages,
      renderedMessages,
      memorySavedPercent: saved,
      isStreaming: state.isStreaming,
      pinnedCount: state.pinnedMessageIds.size
    };
  }

  // ---------------------------------------------------------------------------
  // Observers
  // ---------------------------------------------------------------------------

  function setupScrollTracking(scrollContainer, onScrollChange) {
    let lastCheckTime = 0;
    let frameId = null;

    const now =
      typeof performance !== "undefined" && performance.now
        ? () => performance.now()
        : () => Date.now();

    const runCheck = () => {
      const currentTime = now();
      if (currentTime - lastCheckTime < config.SCROLL_THROTTLE_MS) return;
      lastCheckTime = currentTime;
      
      // Update bottom anchor state on scroll
      state.isUserAtBottom = checkIsUserAtBottom();
      
      onScrollChange();
    };

    const handleScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        runCheck();
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    runCheck();

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }

  function createDebouncedObserver(onMutation, delayMs) {
    let timerId = null;

    return new MutationObserver(() => {
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        onMutation();
      }, delayMs);
    });
  }

  /**
   * Setup ResizeObserver for tracking streaming message height changes.
   */
  function setupResizeObserver() {
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }

    state.resizeObserver = new ResizeObserver((entries) => {
      // Throttle resize-driven virtualization
      scheduleVirtualization("resize");
    });
  }

  // ---------------------------------------------------------------------------
  // Main: boot, teardown, URL watcher
  // ---------------------------------------------------------------------------

  function attachOrUpdateScrollListener() {
    if (!hasAnyMessages()) return;

    const container = findScrollContainer();
    if (!container) return;

    if (container === state.scrollElement && state.cleanupScrollListener) {
      return; // already correct
    }

    if (state.cleanupScrollListener) {
      state.cleanupScrollListener();
      state.cleanupScrollListener = null;
    }

    state.scrollElement = container;
    state.cleanupScrollListener = setupScrollTracking(container, () => {
      scheduleVirtualization("scroll");
    });

    log(
      "Scroll listener attached to:",
      container === window
        ? "window"
        : `${container.tagName} ${container.className || ""}`
    );
  }

  function handleResize() {
    scheduleVirtualization("window-resize");
  }

  function bootVirtualizer() {
    if (state.lifecycleStatus !== "IDLE") {
      log("bootVirtualizer called but already active");
      return;
    }

    const root = findConversationRoot();
    state.conversationRoot = root;

    // Setup resize observer for streaming message height tracking
    setupResizeObserver();

    const mutationObserver = createDebouncedObserver(() => {
      attachOrUpdateScrollListener();
      scheduleVirtualization("mutation");
    }, config.MUTATION_DEBOUNCE_MS);

    mutationObserver.observe(root, { childList: true, subtree: true });

    state.lifecycleStatus = "OBSERVING";
    state.observer = mutationObserver;

    log("Virtualizer booted.");

    // Ensure we start tracking even if messages already exist
    attachOrUpdateScrollListener();
    scheduleVirtualization("boot");
  }

  function teardownVirtualizer() {
    if (state.observer) state.observer.disconnect();
    if (state.cleanupScrollListener) state.cleanupScrollListener();
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = null;
    }

    state.scrollElement = null;
    state.observer = null;
    state.conversationRoot = null;
    state.lifecycleStatus = "IDLE";

    state.articleMap.clear();
    state.nextVirtualId = 1;
    
    // Reset streaming state
    state.isStreaming = false;
    state.pinnedMessageIds.clear();
    state.currentStreamingMessage = null;
    state.lastVirtualizeTime = 0;
    state.virtualizePending = false;
    state.isUserAtBottom = true;

    hasShownBadgeForCurrentChat = false;

    document
      .querySelectorAll('div[data-chatgpt-virtual-spacer="1"]')
      .forEach((spacer) => spacer.remove());
  }

  function startUrlWatcher() {
    setInterval(() => {
      if (window.location.href !== state.lastUrl) {
        state.lastUrl = window.location.href;
        log("URL changed → rebooting virtualizer");
        teardownVirtualizer();
        bootVirtualizer();
      }
    }, config.URL_CHECK_INTERVAL);
  }

  // ---------------------------------------------------------------------------
  // Export public API
  // ---------------------------------------------------------------------------

  scroller.virtualizer = {
    bootVirtualizer,
    teardownVirtualizer,
    startUrlWatcher,
    handleResize,
    getStatsSnapshot
  };
})();
