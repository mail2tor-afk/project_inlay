/*
 * Real-time Video Fact-Check Overlay - Content Script
 * Phase 1: The Shell (UI, Overlay & Manifest)
 * 
 * This script creates a transparent overlay that floats on top of YouTube video player.
 * Features:
 * - Draggable window with minimize/close buttons
 * - Auto-resize based on video player dimensions
 * - Supports Theater mode and Fullscreen
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION & STATE
  // ============================================
  
  const CONFIG = {
    overlayId: 'factcheck-overlay',
    overlayContainerId: 'factcheck-overlay-container',
    headerHeight: 40,
    defaultPosition: { x: 20, y: 100 },
    minSize: { width: 300, height: 200 },
    defaultSize: { width: 400, height: 500 }
  };

  let state = {
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    currentPosition: { x: CONFIG.defaultPosition.x, y: CONFIG.defaultPosition.y },
    currentSize: { ...CONFIG.defaultSize },
    isMinimized: false,
    isVisible: true,
    videoElement: null,
    resizeObserver: null
  };

  // ============================================
  // OVERLAY HTML STRUCTURE
  // ============================================

  function createOverlayHTML() {
    return `
      <div id="${CONFIG.overlayContainerId}" style="display: none;">
        <div id="${CONFIG.overlayId}" class="factcheck-overlay">
          <!-- Header (Draggable Area) -->
          <div class="overlay-header" id="overlay-header">
            <div class="overlay-title">
              <span class="overlay-icon">🔍</span>
              <span>Fact Check</span>
            </div>
            <div class="overlay-controls">
              <button class="overlay-btn overlay-btn-minimize" title="Minimize">−</button>
              <button class="overlay-btn overlay-btn-close" title="Close">×</button>
            </div>
          </div>
          
          <!-- Content Area -->
          <div class="overlay-content" id="overlay-content">
            <div class="overlay-placeholder">
              <p>No active fact-checks</p>
              <p class="overlay-subtitle">Waiting for video transcript...</p>
            </div>
          </div>
          
          <!-- Resize Handle -->
          <div class="overlay-resize-handle" id="resize-handle"></div>
        </div>
      </div>
    `;
  }

  // ============================================
  // CSS STYLES (Tailwind-inspired)
  // ============================================

  function createOverlayStyles() {
    const styles = document.createElement('style');
    styles.textContent = `
      /* Container */
      #${CONFIG.overlayContainerId} {
        position: fixed;
        z-index: 9998;
        pointer-events: none;
      }
      
      /* Main Overlay */
      .factcheck-overlay {
        position: absolute;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        font-size: 14px;
        overflow: hidden;
        transition: all 0.3s ease;
        pointer-events: auto;
        user-select: none;
      }
      
      /* Header */
      .overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: ${CONFIG.headerHeight}px;
        padding: 0 12px;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        cursor: move;
      }
      
      .overlay-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 13px;
      }
      
      .overlay-icon {
        font-size: 16px;
      }
      
      .overlay-controls {
        display: flex;
        gap: 4px;
      }
      
      .overlay-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .overlay-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      
      .overlay-btn-close:hover {
        background: rgba(255, 59, 48, 0.8);
      }
      
      /* Content Area */
      .overlay-content {
        padding: 16px;
        min-height: 120px;
        max-height: calc(100% - ${CONFIG.headerHeight}px);
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      }
      
      .overlay-content::-webkit-scrollbar {
        width: 6px;
      }
      
      .overlay-content::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 3px;
      }
      
      /* Placeholder */
      .overlay-placeholder {
        text-align: center;
        padding: 20px;
        color: rgba(255, 255, 255, 0.5);
      }
      
      .overlay-subtitle {
        font-size: 12px;
        margin-top: 8px;
      }
      
      /* Resize Handle */
      .overlay-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: se-resize;
        background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.3) 50%);
        border-bottom-right-radius: 12px;
      }
      
      /* Minimized State */
      .factcheck-overlay.minimized {
        height: ${CONFIG.headerHeight}px !important;
      }
      
      .factcheck-overlay.minimized .overlay-content,
      .factcheck-overlay.minimized .overlay-resize-handle {
        display: none;
      }
      
      /* Hidden State */
      .factcheck-overlay.hidden {
        opacity: 0;
        pointer-events: none;
      }
      
      /* Fact Check Items */
      .factcheck-item {
        background: rgba(255, 255, 255, 0.05);
        border-left: 3px solid #3b82f6;
        padding: 12px;
        margin-bottom: 12px;
        border-radius: 0 8px 8px 0;
        animation: slideIn 0.3s ease;
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(-10px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      
      .factcheck-timestamp {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.4);
        margin-bottom: 4px;
      }
      
      .factcheck-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }
      
      .factcheck-label.context { color: #3b82f6; }
      .factcheck-label.fact-check { color: #ef4444; }
      .factcheck-label.poll { color: #10b981; }
      
      .factcheck-text {
        font-size: 13px;
        line-height: 1.5;
      }
      
      /* Typewriter effect for streaming text */
      .typewriter {
        border-right: 2px solid #3b82f6;
        animation: blink 0.7s infinite;
      }
      
      @keyframes blink {
        50% { border-color: transparent; }
      }
    `;
    return styles;
  }

  // ============================================
  // DOM MANIPULATION
  // ============================================

  function injectOverlay() {
    // Create container and inject HTML
    const container = document.createElement('div');
    container.innerHTML = createOverlayHTML();
    document.body.appendChild(container);
    
    // Inject styles
    document.head.appendChild(createOverlayStyles());
    
    // Get references
    const overlayContainer = document.getElementById(CONFIG.overlayContainerId);
    const overlay = document.getElementById(CONFIG.overlayId);
    const header = document.getElementById('overlay-header');
    const content = document.getElementById('overlay-content');
    const resizeHandle = document.getElementById('resize-handle');
    const minimizeBtn = overlay.querySelector('.overlay-btn-minimize');
    const closeBtn = overlay.querySelector('.overlay-btn-close');
    
    // Show overlay
    overlayContainer.style.display = 'block';
    
    // Set initial position
    updateOverlayPosition();
    
    // Setup event listeners
    setupDragAndDrop(header, overlay);
    setupResize(resizeHandle, overlay);
    setupButtons(minimizeBtn, closeBtn, overlay);
    
    // Setup ResizeObserver for video player
    setupVideoResizeObserver(overlayContainer);
    
    console.log('[FactCheck] Overlay injected successfully');
  }

  function updateOverlayPosition() {
    const overlay = document.getElementById(CONFIG.overlayId);
    if (overlay) {
      overlay.style.left = `${state.currentPosition.x}px`;
      overlay.style.top = `${state.currentPosition.y}px`;
      overlay.style.width = `${state.currentSize.width}px`;
      overlay.style.height = `${state.currentSize.height}px`;
    }
  }

  // ============================================
  // DRAG AND DROP FUNCTIONALITY
  // ============================================

  function setupDragAndDrop(header, overlay) {
    let startX, startY, initialLeft, initialTop;
    
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.overlay-btn')) return; // Don't drag when clicking buttons
      
      state.isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseInt(window.getComputedStyle(overlay).left || 0);
      initialTop = parseInt(window.getComputedStyle(overlay).top || 0);
      
      overlay.style.transition = 'none'; // Disable transition during drag
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    function onMouseMove(e) {
      if (!state.isDragging) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      state.currentPosition.x = initialLeft + deltaX;
      state.currentPosition.y = initialTop + deltaY;
      
      // Boundary checks
      const rect = overlay.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      
      state.currentPosition.x = Math.max(0, Math.min(state.currentPosition.x, maxX));
      state.currentPosition.y = Math.max(0, Math.min(state.currentPosition.y, maxY));
      
      updateOverlayPosition();
    }
    
    function onMouseUp() {
      state.isDragging = false;
      overlay.style.transition = 'all 0.3s ease'; // Re-enable transition
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      // Save position to storage
      saveOverlayState();
    }
  }

  // ============================================
  // RESIZE FUNCTIONALITY
  // ============================================

  function setupResize(resizeHandle, overlay) {
    let startX, startY, initialWidth, initialHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
      state.isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      initialWidth = parseInt(window.getComputedStyle(overlay).width || 0);
      initialHeight = parseInt(window.getComputedStyle(overlay).height || 0);
      
      overlay.style.transition = 'none';
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    function onMouseMove(e) {
      if (!state.isResizing) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      state.currentSize.width = Math.max(CONFIG.minSize.width, initialWidth + deltaX);
      state.currentSize.height = Math.max(CONFIG.minSize.height, initialHeight + deltaY);
      
      updateOverlayPosition();
    }
    
    function onMouseUp() {
      state.isResizing = false;
      overlay.style.transition = 'all 0.3s ease';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      // Save size to storage
      saveOverlayState();
    }
  }

  // ============================================
  // BUTTON CONTROLS
  // ============================================

  function setupButtons(minimizeBtn, closeBtn, overlay) {
    minimizeBtn.addEventListener('click', () => {
      state.isMinimized = !state.isMinimized;
      overlay.classList.toggle('minimized', state.isMinimized);
      minimizeBtn.textContent = state.isMinimized ? '+' : '−';
      saveOverlayState();
    });
    
    closeBtn.addEventListener('click', () => {
      state.isVisible = false;
      overlay.classList.add('hidden');
      // Can be reopened via popup or keyboard shortcut
    });
  }

  // ============================================
  // VIDEO PLAYER RESIZE OBSERVER
  // ============================================

  function setupVideoResizeObserver(overlayContainer) {
    // Find YouTube video player
    const videoPlayer = document.querySelector('#movie_player') || 
                        document.querySelector('#primary') ||
                        document.querySelector('video');
    
    if (!videoPlayer) {
      console.warn('[FactCheck] Video player not found, retrying...');
      setTimeout(() => setupVideoResizeObserver(overlayContainer), 1000);
      return;
    }
    
    state.videoElement = videoPlayer;
    
    // Use ResizeObserver to track video player size changes
    state.resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        
        // Adjust overlay if it's outside the viewport after resize
        const overlay = document.getElementById(CONFIG.overlayId);
        const overlayRect = overlay.getBoundingClientRect();
        
        if (overlayRect.right > window.innerWidth) {
          state.currentPosition.x = Math.max(0, window.innerWidth - overlayRect.width - 20);
          updateOverlayPosition();
        }
        
        if (overlayRect.bottom > window.innerHeight) {
          state.currentPosition.y = Math.max(0, window.innerHeight - overlayRect.height - 20);
          updateOverlayPosition();
        }
      }
    });
    
    state.resizeObserver.observe(videoPlayer);
    console.log('[FactCheck] ResizeObserver attached to video player');
  }

  // ============================================
  // STATE PERSISTENCE
  // ============================================

  function saveOverlayState() {
    chrome.storage.local.set({
      overlayPosition: state.currentPosition,
      overlaySize: state.currentSize,
      overlayMinimized: state.isMinimized
    });
  }

  function loadOverlayState() {
    chrome.storage.local.get(['overlayPosition', 'overlaySize', 'overlayMinimized'], (result) => {
      if (result.overlayPosition) {
        state.currentPosition = result.overlayPosition;
      }
      if (result.overlaySize) {
        state.currentSize = result.overlaySize;
      }
      if (result.overlayMinimized !== undefined) {
        state.isMinimized = result.overlayMinimized;
        const overlay = document.getElementById(CONFIG.overlayId);
        if (overlay && state.isMinimized) {
          overlay.classList.add('minimized');
        }
      }
      updateOverlayPosition();
    });
  }

  // ============================================
  // PUBLIC API (for other scripts to use)
  // ============================================

  window.FactCheckOverlay = {
    show: () => {
      state.isVisible = true;
      const overlay = document.getElementById(CONFIG.overlayId);
      if (overlay) {
        overlay.classList.remove('hidden');
      }
    },
    
    hide: () => {
      state.isVisible = false;
      const overlay = document.getElementById(CONFIG.overlayId);
      if (overlay) {
        overlay.classList.add('hidden');
      }
    },
    
    toggle: () => {
      state.isVisible = !state.isVisible;
      const overlay = document.getElementById(CONFIG.overlayId);
      if (overlay) {
        overlay.classList.toggle('hidden', !state.isVisible);
      }
    },
    
    addFactCheck: (data) => {
      const content = document.getElementById('overlay-content');
      if (!content) return;
      
      const item = document.createElement('div');
      item.className = 'factcheck-item';
      item.innerHTML = `
        <div class="factcheck-timestamp">${formatTimestamp(data.timestamp)}</div>
        <div class="factcheck-label ${data.type}">${data.type}</div>
        <div class="factcheck-text typewriter">${data.text}</div>
      `;
      
      // Remove placeholder if exists
      const placeholder = content.querySelector('.overlay-placeholder');
      if (placeholder && typeof placeholder.remove === 'function') {
        try {
          placeholder.remove();
        } catch (err) {
          console.error('[Fact-Check Extension] Error removing placeholder:', err);
        }
      }
      
      content.insertBefore(item, content.firstChild);
      
      // Remove typewriter effect after animation
      setTimeout(() => {
        const typewriter = item.querySelector('.typewriter');
        if (typewriter) {
          typewriter.classList.remove('typewriter');
        }
      }, 1000);
    },
    
    clearContent: () => {
      const content = document.getElementById('overlay-content');
      if (content) {
        content.innerHTML = `
          <div class="overlay-placeholder">
            <p>No active fact-checks</p>
            <p class="overlay-subtitle">Waiting for video transcript...</p>
          </div>
        `;
      }
    }
  };

  function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log('[FactCheck] Initializing overlay...');
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        injectOverlay();
        loadOverlayState();
      });
    } else {
      injectOverlay();
      loadOverlayState();
    }
  }

  // Start initialization
  init();

})();
