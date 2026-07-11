// Content Script: Creates and manages the transparent overlay on YouTube
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION & STATE
  // ============================================
  
  const CONFIG = {
    defaultPosition: { x: 100, y: 100 },
    defaultSize: { width: 350, height: 500 },
    minSize: { width: 280, height: 300 },
    storageKey: 'factCheckOverlay_state',
    dragThreshold: 5 // pixels
  };

  let state = {
    isVisible: true,
    isDragging: false,
    isResizing: false,
    isMinimized: false,
    position: { ...CONFIG.defaultPosition },
    size: { ...CONFIG.defaultSize },
    dragStart: { x: 0, y: 0 },
    resizeStart: { width: 0, height: 0, x: 0, y: 0 }
  };

  // ============================================
  // OVERLAY CREATION
  // ============================================

  function createOverlay() {
    // Check if overlay already exists
    if (document.getElementById('fact-check-overlay')) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'fact-check-overlay';
    overlay.className = 'fc-overlay';
    
    overlay.innerHTML = `
      <!-- Header Bar -->
      <div class="fc-header">
        <div class="fc-title">
          <span class="fc-icon">🔍</span>
          <span>Fact-Check Overlay</span>
        </div>
        <div class="fc-controls">
          <button class="fc-btn fc-btn-minimize" title="Minimize">−</button>
          <button class="fc-btn fc-btn-close" title="Close">×</button>
        </div>
      </div>

      <!-- Resize Handle (Top-Left) -->
      <div class="fc-resize-handle" title="Resize"></div>

      <!-- Content Area -->
      <div class="fc-content">
        <div class="fc-loading">
          <div class="fc-spinner"></div>
          <p>Analyzing video...</p>
        </div>
        
        <div class="fc-fact-checks" style="display: none;">
          <!-- Fact checks will be injected here -->
        </div>

        <div class="fc-poll" style="display: none;">
          <!-- Live poll will be injected here -->
        </div>

        <div class="fc-context" style="display: none;">
          <!-- Context information will be injected here -->
        </div>
      </div>

      <!-- Footer -->
      <div class="fc-footer">
        <div class="fc-status">
          <span class="fc-status-dot"></span>
          <span class="fc-status-text">Ready</span>
        </div>
        <div class="fc-timer">00:00</div>
      </div>
    `;

    // Apply styles
    applyStyles(overlay);
    
    // Add to DOM
    document.body.appendChild(overlay);

    // Load saved state
    loadState();

    // Setup event listeners
    setupEventListeners(overlay);

    // Setup resize observer
    setupResizeObserver(overlay);

    console.log('[Fact-Check Overlay] Initialized');
  }

  // ============================================
  // STYLING
  // ============================================

  function applyStyles(overlay) {
    const style = document.createElement('style');
    style.textContent = `
      .fc-overlay {
        position: fixed;
        z-index: 999999;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #f1f5f9;
        overflow: hidden;
        transition: opacity 0.2s ease, transform 0.2s ease;
        user-select: none;
      }

      .fc-overlay.fc-hidden {
        opacity: 0;
        pointer-events: none;
      }

      .fc-overlay.fc-minimized .fc-content {
        display: none;
      }

      .fc-overlay.fc-minimized .fc-footer {
        display: none;
      }

      .fc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: rgba(30, 41, 59, 0.6);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        cursor: move;
      }

      .fc-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
      }

      .fc-icon {
        font-size: 16px;
      }

      .fc-controls {
        display: flex;
        gap: 6px;
      }

      .fc-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        color: #f1f5f9;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .fc-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .fc-btn-close:hover {
        background: rgba(239, 68, 68, 0.8);
      }

      .fc-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: 20px;
        height: 20px;
        cursor: nwse-resize;
        z-index: 10;
      }

      .fc-content {
        padding: 16px;
        max-height: calc(100% - 100px);
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
      }

      .fc-content::-webkit-scrollbar {
        width: 6px;
      }

      .fc-content::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
      }

      .fc-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
      }

      .fc-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.1);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 16px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .fc-fact-checks, .fc-poll, .fc-context {
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .fc-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: rgba(30, 41, 59, 0.4);
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 12px;
        color: #94a3b8;
      }

      .fc-status {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .fc-status-dot {
        width: 8px;
        height: 8px;
        background: #22c55e;
        border-radius: 50%;
        animation: pulse 2s ease infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Fact Check Item Styles */
      .fc-fact-item {
        background: rgba(255, 255, 255, 0.05);
        border-left: 3px solid #3b82f6;
        padding: 12px;
        margin-bottom: 12px;
        border-radius: 0 8px 8px 0;
      }

      .fc-fact-item.fc-true {
        border-left-color: #22c55e;
      }

      .fc-fact-item.fc-false {
        border-left-color: #ef4444;
      }

      .fc-fact-item.fc-misleading {
        border-left-color: #f59e0b;
      }

      .fc-fact-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }

      .fc-fact-true { color: #22c55e; }
      .fc-fact-false { color: #ef4444; }
      .fc-fact-misleading { color: #f59e0b; }

      .fc-fact-text {
        font-size: 13px;
        line-height: 1.5;
        color: #e2e8f0;
      }

      .fc-fact-source {
        font-size: 11px;
        color: #64748b;
        margin-top: 8px;
        font-style: italic;
      }

      /* Poll Styles */
      .fc-poll-question {
        font-weight: 600;
        margin-bottom: 12px;
        font-size: 14px;
      }

      .fc-poll-option {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .fc-poll-option:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      .fc-poll-bar {
        height: 6px;
        background: rgba(59, 130, 246, 0.3);
        border-radius: 3px;
        margin-top: 6px;
        overflow: hidden;
      }

      .fc-poll-fill {
        height: 100%;
        background: #3b82f6;
        border-radius: 3px;
        transition: width 0.5s ease;
      }
    `;

    document.head.appendChild(style);

    // Apply position and size
    overlay.style.left = state.position.x + 'px';
    overlay.style.top = state.position.y + 'px';
    overlay.style.width = state.size.width + 'px';
    overlay.style.height = state.size.height + 'px';
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function setupEventListeners(overlay) {
    const header = overlay.querySelector('.fc-header');
    const minimizeBtn = overlay.querySelector('.fc-btn-minimize');
    const closeBtn = overlay.querySelector('.fc-btn-close');
    const resizeHandle = overlay.querySelector('.fc-resize-handle');

    // Dragging
    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);

    // Minimize
    minimizeBtn.addEventListener('click', () => {
      state.isMinimized = !state.isMinimized;
      overlay.classList.toggle('fc-minimized', state.isMinimized);
      saveState();
    });

    // Close (hide)
    closeBtn.addEventListener('click', () => {
      hideOverlay();
    });

    // Resizing
    resizeHandle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', endResize);

    // Double-click header to toggle maximize
    header.addEventListener('dblclick', () => {
      toggleMaximize();
    });
  }

  function startDrag(e) {
    if (e.target.closest('.fc-controls')) return;
    
    state.isDragging = true;
    state.dragStart.x = e.clientX - state.position.x;
    state.dragStart.y = e.clientY - state.position.y;
    
    const overlay = document.getElementById('fact-check-overlay');
    overlay.style.transition = 'none';
  }

  function onDrag(e) {
    if (!state.isDragging) return;

    const overlay = document.getElementById('fact-check-overlay');
    state.position.x = e.clientX - state.dragStart.x;
    state.position.y = e.clientY - state.dragStart.y;

    // Boundary checks
    state.position.x = Math.max(0, Math.min(state.position.x, window.innerWidth - overlay.offsetWidth));
    state.position.y = Math.max(0, Math.min(state.position.y, window.innerHeight - overlay.offsetHeight));

    overlay.style.left = state.position.x + 'px';
    overlay.style.top = state.position.y + 'px';
  }

  function endDrag() {
    state.isDragging = false;
    const overlay = document.getElementById('fact-check-overlay');
    overlay.style.transition = '';
    saveState();
  }

  function startResize(e) {
    e.preventDefault();
    state.isResizing = true;
    state.resizeStart = {
      width: state.size.width,
      height: state.size.height,
      x: e.clientX,
      y: e.clientY
    };
    
    const overlay = document.getElementById('fact-check-overlay');
    overlay.style.transition = 'none';
  }

  function onResize(e) {
    if (!state.isResizing) return;

    const overlay = document.getElementById('fact-check-overlay');
    const deltaX = e.clientX - state.resizeStart.x;
    const deltaY = e.clientY - state.resizeStart.y;

    state.size.width = Math.max(CONFIG.minSize.width, state.resizeStart.width - deltaX);
    state.size.height = Math.max(CONFIG.minSize.height, state.resizeStart.height - deltaY);

    overlay.style.width = state.size.width + 'px';
    overlay.style.height = state.size.height + 'px';
  }

  function endResize() {
    state.isResizing = false;
    const overlay = document.getElementById('fact-check-overlay');
    overlay.style.transition = '';
    saveState();
  }

  function toggleMaximize() {
    const overlay = document.getElementById('fact-check-overlay');
    const isMaximized = state.size.width > CONFIG.defaultSize.width * 1.5;
    
    if (isMaximized) {
      state.size = { ...CONFIG.defaultSize };
    } else {
      state.size = {
        width: Math.min(600, window.innerWidth - 200),
        height: Math.min(700, window.innerHeight - 200)
      };
    }
    
    overlay.style.width = state.size.width + 'px';
    overlay.style.height = state.size.height + 'px';
    saveState();
  }

  // ============================================
  // RESIZE OBSERVER
  // ============================================

  function setupResizeObserver(overlay) {
    const videoContainer = document.querySelector('#movie_player') || document.querySelector('#primary');
    
    if (!videoContainer) {
      console.warn('[Fact-Check Overlay] Video container not found');
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // Adjust overlay position if video container changes significantly
        const rect = entry.target.getBoundingClientRect();
        
        // Keep overlay within visible area
        if (state.position.x + state.size.width > window.innerWidth) {
          state.position.x = Math.max(10, window.innerWidth - state.size.width - 10);
          overlay.style.left = state.position.x + 'px';
        }
        
        if (state.position.y + state.size.height > window.innerHeight) {
          state.position.y = Math.max(10, window.innerHeight - state.size.height - 10);
          overlay.style.top = state.position.y + 'px';
        }
      }
    });

    observer.observe(videoContainer);
  }

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  function loadState() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.position = { ...CONFIG.defaultPosition, ...parsed.position };
        state.size = { ...CONFIG.defaultSize, ...parsed.size };
        state.isVisible = parsed.isVisible !== false;
        
        const overlay = document.getElementById('fact-check-overlay');
        overlay.style.left = state.position.x + 'px';
        overlay.style.top = state.position.y + 'px';
        overlay.style.width = state.size.width + 'px';
        overlay.style.height = state.size.height + 'px';
        
        // FORCE overlay to always be visible for debugging
        state.isVisible = true;
        overlay.classList.remove('fc-hidden');
      }
    } catch (error) {
      console.error('[Fact-Check Overlay] Failed to load state:', error);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        position: state.position,
        size: state.size,
        isVisible: state.isVisible
      }));
    } catch (error) {
      console.error('[Fact-Check Overlay] Failed to save state:', error);
    }
  }

  function hideOverlay() {
    state.isVisible = false;
    const overlay = document.getElementById('fact-check-overlay');
    overlay.classList.add('fc-hidden');
    saveState();
  }

  function showOverlay() {
    state.isVisible = true;
    const overlay = document.getElementById('fact-check-overlay');
    overlay.classList.remove('fc-hidden');
    saveState();
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.FactCheckOverlay = {
    show: showOverlay,
    hide: hideOverlay,
    toggle: () => {
      if (state.isVisible) {
        hideOverlay();
      } else {
        showOverlay();
      }
    },
    addFactCheck: (data) => {
      const contentDiv = document.querySelector('.fc-fact-checks');
      if (!contentDiv) return;

      contentDiv.style.display = 'block';
      document.querySelector('.fc-loading').style.display = 'none';

      const factItem = document.createElement('div');
      factItem.className = `fc-fact-item fc-${data.verdict || 'neutral'}`;
      
      const labelMap = {
        true: '✅ VERIFIED',
        false: '❌ FALSE',
        misleading: '⚠️ MISLEADING',
        neutral: 'ℹ️ CONTEXT'
      };

      factItem.innerHTML = `
        <div class="fc-fact-label ${'fc-fact-' + (data.verdict || 'neutral')}">${labelMap[data.verdict || 'neutral'] || labelMap.neutral}</div>
        <div class="fc-fact-text">${data.text}</div>
        ${data.source ? `<div class="fc-fact-source">Source: ${data.source}</div>` : ''}
      `;

      contentDiv.appendChild(factItem);
      contentDiv.scrollTop = contentDiv.scrollHeight;
    },
    updateStatus: (text) => {
      const statusText = document.querySelector('.fc-status-text');
      if (statusText) {
        statusText.textContent = text;
      }
    },
    updateTimer: (seconds) => {
      const timerDiv = document.querySelector('.fc-timer');
      if (timerDiv) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerDiv.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
    }
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  // ============================================
  // MESSAGE LISTENER
  // ============================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showOverlay') {
      showOverlay();
      sendResponse({ status: 'ok' });
    } else if (message.action === 'hideOverlay') {
      hideOverlay();
      sendResponse({ status: 'ok' });
    }
  });

  // Wait for YouTube to load
  function waitForYouTube() {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const player = document.querySelector('#movie_player') || document.querySelector('video');
      
      if (player || attempts > 20) { // Fallback after 10 seconds even if player not found
        clearInterval(checkInterval);
        console.log('[Fact-Check Overlay] Initializing UI...');
        createOverlay();
        
        // Start timer
        let seconds = 0;
        setInterval(() => {
          seconds++;
          if (window.FactCheckOverlay) {
            window.FactCheckOverlay.updateTimer(seconds);
          }
        }, 1000);
        
        // Initialize Socket.IO connection
        initSocketIO();
      }
    }, 500);
  }

  // ============================================
  // SOCKET.IO INTEGRATION
  // ============================================
  function initSocketIO() {
    if (typeof io === 'undefined') {
      console.warn('[Fact-Check Overlay] Socket.IO library not loaded yet.');
      return;
    }
    
    const socket = io('http://localhost:3000');
    let timeUpdateInterval = null;
    
    socket.on('connect', () => {
      console.log('[Fact-Check Overlay] Connected to Backend');
      window.FactCheckOverlay.updateStatus('Connected to Backend');
      
      const urlParams = new URLSearchParams(window.location.search);
      let videoId = urlParams.get('v');
      
      if (videoId) {
        socket.emit('join_video', videoId);
        
        // Start sending time updates every 1 second
        timeUpdateInterval = setInterval(() => {
          const videoElement = document.querySelector('video');
          if (videoElement && videoElement.currentTime > 0) {
            // Re-check videoId in case of SPA navigation
            const currentUrlParams = new URLSearchParams(window.location.search);
            const currentVideoId = currentUrlParams.get('v');
            
            if (currentVideoId && currentVideoId !== videoId) {
              socket.emit('leave_video', videoId);
              videoId = currentVideoId;
              socket.emit('join_video', videoId);
            }
            
            socket.emit('video_time_update', {
              videoId: videoId,
              currentTime: videoElement.currentTime
            });
          }
        }, 1000);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Fact-Check Overlay] Disconnected from Backend');
      window.FactCheckOverlay.updateStatus('Disconnected');
      if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
      }
    });

    // Handle incoming fact check streaming
    let currentStreamingItem = null;
    let textBuffer = "";
    
    socket.on('factcheck_update', (data) => {
      if (data.type === 'chunk') {
        if (!currentStreamingItem) {
          // Hide loading, show content area
          const contentDiv = document.querySelector('.fc-fact-checks');
          if (contentDiv) {
            contentDiv.style.display = 'block';
            document.querySelector('.fc-loading').style.display = 'none';
          }
          
          // Create new item for streaming
          currentStreamingItem = document.createElement('div');
          currentStreamingItem.className = `fc-fact-item fc-neutral`;
          currentStreamingItem.innerHTML = `
            <div class="fc-fact-label fc-fact-neutral">AI FACT-CHECKING...</div>
            <div class="fc-fact-text"></div>
          `;
          contentDiv.appendChild(currentStreamingItem);
        }
        // Update text (Typewriter effect driven by chunk)
        textBuffer = data.text;
        const textDiv = currentStreamingItem.querySelector('.fc-fact-text');
        if (textDiv) textDiv.textContent = textBuffer;
        
        const contentDiv = document.querySelector('.fc-fact-checks');
        contentDiv.scrollTop = contentDiv.scrollHeight;
      } 
      else if (data.type === 'done') {
        if (!currentStreamingItem) {
          // Latecomer or full result at once
          window.FactCheckOverlay.addFactCheck({
            verdict: 'neutral',
            text: data.text,
            source: 'AI Analysis'
          });
        } else {
          // Finalize streaming item
          const textDiv = currentStreamingItem.querySelector('.fc-fact-text');
          if (textDiv) textDiv.textContent = data.text;
          const labelDiv = currentStreamingItem.querySelector('.fc-fact-label');
          if (labelDiv) labelDiv.textContent = "✅ COMPLETED";
          currentStreamingItem = null;
          textBuffer = "";
        }
      }
      else if (data.type === 'cancel') {
        if (currentStreamingItem) {
          currentStreamingItem.remove();
          currentStreamingItem = null;
          textBuffer = "";
        }
      }
    });
  }

  // Start initialization
  console.log('[Fact-Check Overlay] Content script loaded, starting initialization...');
  waitForYouTube();

})();
