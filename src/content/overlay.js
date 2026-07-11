// Content Script: Creates and manages the transparent overlay on YouTube
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION & STATE
  // ============================================
  
  const CONFIG = {
    defaultPosition: { x: 100, y: 100 },
    defaultSize: { width: 360, height: 520 },
    minSize: { width: 280, height: 300 },
    storageKey: 'factCheckOverlay_state',
    dragThreshold: 5 // pixels
  };

  let state = {
    isVisible: true,
    isDragging: false,
    isResizing: false,
    isMinimized: false,
    isPaused: false,
    isSettingsOpen: false,
    fontSize: 15,    // Default font size (px)
    opacity: 85,     // Default background opacity (%)
    position: { ...CONFIG.defaultPosition },
    size: { ...CONFIG.defaultSize },
    dragStart: { x: 0, y: 0 },
    resizeStart: { width: 0, height: 0, x: 0, y: 0 }
  };

  // Color palette for speakers (Border colors and subtle backgrounds)
  const speakerColors = [
    { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', text: '#3b82f6' }, // Blue
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', text: '#10b981' }, // Green
    { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.08)', text: '#a855f7' }, // Purple
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', text: '#f59e0b' },  // Orange
    { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.08)', text: '#ec4899' }, // Pink
    { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.08)', text: '#06b6d4' }   // Cyan
  ];
  const speakerColorMap = {};
  let colorIndex = 0;

  function getSpeakerColor(speakerName) {
    if (!speakerName || speakerName === 'Unknown' || speakerName === 'ผู้พูด') {
      return { border: '#64748b', bg: 'rgba(100, 116, 139, 0.05)', text: '#94a3b8' };
    }
    if (!speakerColorMap[speakerName]) {
      speakerColorMap[speakerName] = speakerColors[colorIndex % speakerColors.length];
      colorIndex++;
    }
    return speakerColorMap[speakerName];
  }

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
          <button class="fc-btn fc-btn-settings" title="Settings">⚙️</button>
          <button class="fc-btn fc-btn-pause" title="Pause Analysis">⏸️</button>
          <button class="fc-btn fc-btn-minimize" title="Minimize">−</button>
          <button class="fc-btn fc-btn-close" title="Close">×</button>
        </div>
      </div>

      <!-- Settings Panel -->
      <div class="fc-settings-panel" style="display: none;">
        <div class="fc-setting-row">
          <label>ความโปร่งใสพื้นหลัง (Opacity): <span id="fc-opacity-val">85%</span></label>
          <input type="range" id="fc-opacity-slider" min="30" max="100" value="85">
        </div>
        <div class="fc-setting-row">
          <label>ขนาดตัวอักษร (Font Size):</label>
          <div class="fc-font-btns">
            <button class="fc-font-btn" data-size="13">เล็ก</button>
            <button class="fc-font-btn fc-font-active" data-size="15">กลาง</button>
            <button class="fc-font-btn" data-size="18">ใหญ่</button>
          </div>
        </div>
      </div>

      <!-- Current Topic Sticky Header -->
      <div class="fc-topic-bar" style="display: none;">
        <span class="fc-topic-label">หัวข้อ:</span>
        <span class="fc-topic-text">กำลังวิเคราะห์ประเด็น...</span>
      </div>

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

      <!-- Resize Handle (Bottom-Right Corner) -->
      <div class="fc-resize-handle" title="Resize"></div>

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
        background: rgba(15, 23, 42, var(--fc-bg-opacity, 0.85));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #f1f5f9;
        overflow: hidden;
        transition: opacity 0.2s ease, transform 0.2s ease, background 0.15s ease;
        user-select: none;
      }

      .fc-overlay.fc-hidden {
        opacity: 0;
        pointer-events: none;
      }

      .fc-overlay.fc-minimized .fc-content,
      .fc-overlay.fc-minimized .fc-settings-panel,
      .fc-overlay.fc-minimized .fc-topic-bar,
      .fc-overlay.fc-minimized .fc-footer,
      .fc-overlay.fc-minimized .fc-resize-handle {
        display: none !important;
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
        background: rgba(255, 255, 255, 0.08);
        color: #f1f5f9;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, transform 0.1s;
      }

      .fc-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        transform: scale(1.05);
      }

      .fc-btn:active {
        transform: scale(0.95);
      }

      .fc-btn-close:hover {
        background: rgba(239, 68, 68, 0.8);
      }

      /* Settings Panel Styling */
      .fc-settings-panel {
        background: rgba(30, 41, 59, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding: 14px 16px;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes slideDown {
        from { transform: translateY(-10px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .fc-setting-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .fc-setting-row label {
        color: #94a3b8;
        font-weight: 500;
        display: flex;
        justify-content: space-between;
      }

      .fc-setting-row input[type="range"] {
        width: 100%;
        accent-color: #3b82f6;
        cursor: pointer;
        margin: 4px 0;
      }

      .fc-font-btns {
        display: flex;
        gap: 8px;
      }

      .fc-font-btn {
        flex: 1;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        color: #e2e8f0;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
        text-align: center;
      }

      .fc-font-btn:hover {
        background: rgba(255, 255, 255, 0.12);
      }

      .fc-font-btn.fc-font-active {
        background: #3b82f6;
        border-color: #3b82f6;
        color: #ffffff;
        font-weight: 600;
      }

      /* Topic Sticky Bar */
      .fc-topic-bar {
        background: rgba(15, 23, 42, 0.6);
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 600;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: border-left 0.4s ease, border-bottom 0.2s;
        border-left: 4px solid #64748b; /* Will match the initiating speaker */
      }

      .fc-topic-label {
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .fc-topic-text {
        color: #f1f5f9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Content Scroll Area */
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
        width: 32px;
        height: 32px;
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
        animation: fadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Fact Check Item Styles */
      .fc-fact-item {
        background: var(--speaker-bg, rgba(255, 255, 255, 0.04));
        border-left: 4px solid var(--speaker-color, #64748b);
        padding: 16px;
        margin-bottom: 16px;
        border-radius: 8px;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
      }

      .fc-fact-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }

      .fc-fact-speaker {
        color: var(--speaker-color, #94a3b8);
        text-transform: uppercase;
      }

      .fc-fact-label {
        text-transform: uppercase;
        border-radius: 4px;
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.08);
      }

      .fc-fact-item.fc-verified {
        background: rgba(16, 185, 129, 0.05);
      }
      .fc-fact-item.fc-verified .fc-fact-label {
        color: #10b981;
        background: rgba(16, 185, 129, 0.15);
      }

      .fc-fact-item.fc-false {
        background: rgba(239, 68, 68, 0.05);
      }
      .fc-fact-item.fc-false .fc-fact-label {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.15);
      }

      .fc-fact-item.fc-misleading {
        background: rgba(245, 158, 11, 0.05);
      }
      .fc-fact-item.fc-misleading .fc-fact-label {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.15);
      }

      .fc-fact-item.fc-neutral {
        background: rgba(148, 163, 184, 0.05);
      }
      .fc-fact-item.fc-neutral .fc-fact-label {
        color: #94a3b8;
        background: rgba(148, 163, 184, 0.15);
      }

      .fc-fact-text {
        font-size: var(--fc-font-size, 15px);
        line-height: 1.6;
        color: #e2e8f0;
        white-space: pre-line; /* Supports paragraphs and newlines */
      }

      .fc-fact-source {
        font-size: 11px;
        color: #64748b;
        margin-top: 10px;
        font-style: italic;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
        padding-top: 6px;
      }

      /* Resize Handle - Bottom Right Corner */
      .fc-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: se-resize;
        z-index: 1000;
        background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.25) 50%);
      }

      /* Footer */
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
    `;

    document.head.appendChild(style);

    // Apply state variable styles
    applyStateStyles();
  }

  function applyStateStyles() {
    const overlay = document.getElementById('fact-check-overlay');
    if (!overlay) return;

    // Apply layout positions
    overlay.style.left = state.position.x + 'px';
    overlay.style.top = state.position.y + 'px';
    overlay.style.width = state.size.width + 'px';
    overlay.style.height = state.size.height + 'px';

    // Apply dynamic variables
    overlay.style.setProperty('--fc-bg-opacity', (state.opacity / 100).toFixed(2));
    overlay.style.setProperty('--fc-font-size', state.fontSize + 'px');
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function setupEventListeners(overlay) {
    const header = overlay.querySelector('.fc-header');
    const minimizeBtn = overlay.querySelector('.fc-btn-minimize');
    const closeBtn = overlay.querySelector('.fc-btn-close');
    const pauseBtn = overlay.querySelector('.fc-btn-pause');
    const settingsBtn = overlay.querySelector('.fc-btn-settings');
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

    // Pause/Resume Analysis
    pauseBtn.addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      if (state.isPaused) {
        pauseBtn.textContent = '▶️';
        pauseBtn.title = 'Resume Analysis';
        window.FactCheckOverlay.updateStatus('Analysis Paused');
      } else {
        pauseBtn.textContent = '⏸️';
        pauseBtn.title = 'Pause Analysis';
        window.FactCheckOverlay.updateStatus('Connected to Backend');
      }
      saveState();
    });

    // Settings Toggle
    settingsBtn.addEventListener('click', () => {
      state.isSettingsOpen = !state.isSettingsOpen;
      overlay.querySelector('.fc-settings-panel').style.display = state.isSettingsOpen ? 'flex' : 'none';
    });

    // Opacity Slider Controls
    const opacitySlider = overlay.querySelector('#fc-opacity-slider');
    const opacityValSpan = overlay.querySelector('#fc-opacity-val');
    opacitySlider.addEventListener('input', (e) => {
      state.opacity = parseInt(e.target.value);
      opacityValSpan.textContent = state.opacity + '%';
      overlay.style.setProperty('--fc-bg-opacity', (state.opacity / 100).toFixed(2));
      saveState();
    });

    // Font Size Buttons Controls
    const fontBtns = overlay.querySelectorAll('.fc-font-btn');
    fontBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        fontBtns.forEach(b => b.classList.remove('fc-font-active'));
        e.target.classList.add('fc-font-active');
        state.fontSize = parseInt(e.target.dataset.size);
        overlay.style.setProperty('--fc-font-size', state.fontSize + 'px');
        saveState();
      });
    });

    // Resizing (Bottom-Right Handle)
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

    // Boundary checks relative to browser window
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

    state.size.width = Math.max(CONFIG.minSize.width, state.resizeStart.width + deltaX);
    state.size.height = Math.max(CONFIG.minSize.height, state.resizeStart.height + deltaY);

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
  // RESIZE OBSERVER (Window alignment checks)
  // ============================================

  function setupResizeObserver(overlay) {
    const videoContainer = document.querySelector('#movie_player') || document.querySelector('#primary');
    
    if (!videoContainer) {
      console.warn('[Fact-Check Overlay] Video container not found');
      return;
    }

    const observer = new ResizeObserver(() => {
      // Keep overlay within visible bounds on viewport resize
      if (state.position.x + state.size.width > window.innerWidth) {
        state.position.x = Math.max(10, window.innerWidth - state.size.width - 10);
        overlay.style.left = state.position.x + 'px';
      }
      
      if (state.position.y + state.size.height > window.innerHeight) {
        state.position.y = Math.max(10, window.innerHeight - state.size.height - 10);
        overlay.style.top = state.position.y + 'px';
      }
    });

    observer.observe(videoContainer);
  }

  // ============================================
  // STATE MANAGEMENT (Persistence)
  // ============================================

  function loadState() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.position = { ...CONFIG.defaultPosition, ...parsed.position };
        state.size = { ...CONFIG.defaultSize, ...parsed.size };
        state.isVisible = parsed.isVisible !== false;
        state.isPaused = parsed.isPaused === true;
        state.fontSize = parsed.fontSize || 15;
        state.opacity = parsed.opacity !== undefined ? parsed.opacity : 85;
        
        const overlay = document.getElementById('fact-check-overlay');
        applyStateStyles();
        
        // Update Pause button icon based on loaded state
        const pauseBtn = overlay.querySelector('.fc-btn-pause');
        if (pauseBtn) {
          pauseBtn.textContent = state.isPaused ? '▶️' : '⏸️';
          pauseBtn.title = state.isPaused ? 'Resume Analysis' : 'Pause Analysis';
        }

        // Update Opacity settings values
        const opacitySlider = overlay.querySelector('#fc-opacity-slider');
        const opacityValSpan = overlay.querySelector('#fc-opacity-val');
        if (opacitySlider && opacityValSpan) {
          opacitySlider.value = state.opacity;
          opacityValSpan.textContent = state.opacity + '%';
        }

        // Update Font active states
        const fontBtns = overlay.querySelectorAll('.fc-font-btn');
        fontBtns.forEach(btn => {
          if (parseInt(btn.dataset.size) === state.fontSize) {
            btn.classList.add('fc-font-active');
          } else {
            btn.classList.remove('fc-font-active');
          }
        });
        
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
        isVisible: state.isVisible,
        isPaused: state.isPaused,
        fontSize: state.fontSize,
        opacity: state.opacity
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
      let verdictClass = (data.verdict || 'neutral').toLowerCase();
      if (verdictClass === 'context_needed') verdictClass = 'neutral';
      
      factItem.className = `fc-fact-item fc-${verdictClass}`;
      
      const spkColor = getSpeakerColor(data.speaker);
      factItem.style.setProperty('--speaker-color', spkColor.border);
      factItem.style.setProperty('--speaker-bg', spkColor.bg);

      const labelMap = {
        verified: '✅ VERIFIED',
        false: '❌ FALSE',
        misleading: '⚠️ MISLEADING',
        neutral: 'ℹ️ CONTEXT',
        context_needed: 'ℹ️ CONTEXT'
      };

      factItem.innerHTML = `
        <div class="fc-fact-header">
          <span class="fc-fact-speaker" style="color: ${spkColor.border}">${data.speaker || 'Unknown'}</span>
          <span class="fc-fact-label">${labelMap[verdictClass] || labelMap.neutral}</span>
        </div>
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

  // Helper to parse streaming responses containing tags
  function parseTaggedResponse(text) {
    const topicMatch = text.match(/\[TOPIC:\s*([^\]]*?)\]/i);
    const speakerMatch = text.match(/\[SPEAKER:\s*([^\]]*?)\]/i);
    const verdictMatch = text.match(/\[VERDICT:\s*([^\]]*?)\]/i);
    const analysisMatch = text.match(/\[ANALYSIS:\s*([\s\S]*)/i);

    return {
      topic: topicMatch ? topicMatch[1].trim() : null,
      speaker: speakerMatch ? speakerMatch[1].trim() : null,
      verdict: verdictMatch ? verdictMatch[1].trim() : null,
      analysis: analysisMatch ? analysisMatch[1].trim() : null
    };
  }

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
      
      if (player || attempts > 20) {
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
  // SOCKET.IO INTEGRATION & STREAM PARSING
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
      window.FactCheckOverlay.updateStatus(state.isPaused ? 'Analysis Paused' : 'Connected to Backend');
      
      const urlParams = new URLSearchParams(window.location.search);
      let videoId = urlParams.get('v');
      
      if (videoId) {
        socket.emit('join_video', videoId);
        
        // Start sending time updates every 1 second
        timeUpdateInterval = setInterval(() => {
          if (state.isPaused) return;

          const videoElement = document.querySelector('video');
          if (videoElement && videoElement.currentTime > 0) {
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
        textBuffer = data.text;
        const parsed = parseTaggedResponse(textBuffer);

        // Hide loading spinner, show content area
        const contentDiv = document.querySelector('.fc-fact-checks');
        const loadingDiv = document.querySelector('.fc-loading');
        if (contentDiv && loadingDiv) {
          contentDiv.style.display = 'block';
          loadingDiv.style.display = 'none';
        }

        // 1. Update Topic Header if parsed
        const topicBar = document.querySelector('.fc-topic-bar');
        const topicTextSpan = document.querySelector('.fc-topic-text');
        if (topicBar && topicTextSpan && parsed.topic) {
          topicBar.style.display = 'flex';
          topicTextSpan.textContent = parsed.topic;
          
          // Apply matching color of the speaker to topic bar border
          if (parsed.speaker) {
            const spkColor = getSpeakerColor(parsed.speaker);
            topicBar.style.borderLeftColor = spkColor.border;
            topicTextSpan.style.color = spkColor.border;
          }
        }

        // 2. Manage the fact check card
        if (parsed.analysis) {
          if (!currentStreamingItem) {
            currentStreamingItem = document.createElement('div');
            contentDiv.appendChild(currentStreamingItem);
          }

          // Apply verdict class and colors
          let verdictClass = (parsed.verdict || 'neutral').toLowerCase();
          if (verdictClass === 'context_needed') verdictClass = 'neutral';
          
          currentStreamingItem.className = `fc-fact-item fc-${verdictClass}`;
          
          const spkColor = getSpeakerColor(parsed.speaker);
          currentStreamingItem.style.setProperty('--speaker-color', spkColor.border);
          currentStreamingItem.style.setProperty('--speaker-bg', spkColor.bg);

          const labelMap = {
            verified: '✅ VERIFIED',
            false: '❌ FALSE',
            misleading: '⚠️ MISLEADING',
            neutral: 'ℹ️ CONTEXT',
            context_needed: 'ℹ️ CONTEXT'
          };

          currentStreamingItem.innerHTML = `
            <div class="fc-fact-header">
              <span class="fc-fact-speaker" style="color: ${spkColor.border}">${parsed.speaker || 'Unknown'}</span>
              <span class="fc-fact-label">${labelMap[verdictClass] || labelMap.neutral}</span>
            </div>
            <div class="fc-fact-text">${parsed.analysis}</div>
          `;
          
          contentDiv.scrollTop = contentDiv.scrollHeight;
        }
      } 
      else if (data.type === 'done') {
        const parsed = parseTaggedResponse(data.text);
        if (parsed.analysis) {
          if (!currentStreamingItem) {
            window.FactCheckOverlay.addFactCheck({
              verdict: parsed.verdict || 'neutral',
              speaker: parsed.speaker || 'Unknown',
              text: parsed.analysis,
              source: 'AI Analysis'
            });
          } else {
            // Finalize current card styling and reset buffer references
            let verdictClass = (parsed.verdict || 'neutral').toLowerCase();
            if (verdictClass === 'context_needed') verdictClass = 'neutral';
            
            currentStreamingItem.className = `fc-fact-item fc-${verdictClass}`;
            
            const spkColor = getSpeakerColor(parsed.speaker);
            currentStreamingItem.style.setProperty('--speaker-color', spkColor.border);
            currentStreamingItem.style.setProperty('--speaker-bg', spkColor.bg);

            const labelMap = {
              verified: '✅ VERIFIED',
              false: '❌ FALSE',
              misleading: '⚠️ MISLEADING',
              neutral: 'ℹ️ CONTEXT',
              context_needed: 'ℹ️ CONTEXT'
            };

            currentStreamingItem.innerHTML = `
              <div class="fc-fact-header">
                <span class="fc-fact-speaker" style="color: ${spkColor.border}">${parsed.speaker || 'Unknown'}</span>
                <span class="fc-fact-label">${labelMap[verdictClass] || labelMap.neutral}</span>
              </div>
              <div class="fc-fact-text">${parsed.analysis}</div>
              <div class="fc-fact-source">Source: AI Analysis</div>
            `;
            
            currentStreamingItem = null;
            textBuffer = "";
          }
        }
      }
      else if (data.type === 'cancel') {
        if (currentStreamingItem) {
          currentStreamingItem.remove();
          currentStreamingItem = null;
          textBuffer = "";
        }
      }
      else if (data.type === 'error') {
        window.FactCheckOverlay.addFactCheck({
          verdict: 'neutral',
          speaker: 'System Error',
          text: data.message || 'An error occurred during fact-checking.',
          source: 'System Diagnostics'
        });
        window.FactCheckOverlay.updateStatus('Error - check API key');
      }
    });
  }

  // Start initialization
  console.log('[Fact-Check Overlay] Content script loaded, starting initialization...');
  waitForYouTube();

})();
