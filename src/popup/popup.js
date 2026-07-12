// Popup Script: Handles UI interactions and communication with background script

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] Initialized');

  // Toggle buttons
  const overlayToggle = document.getElementById('overlayToggle');

  // Status elements
  const backendStatusEl = document.getElementById('backendStatus');
  const lastSyncEl = document.getElementById('lastSync');

  // Load settings from storage
  loadSettings();

  // Event Listeners
  overlayToggle.addEventListener('click', () => toggleSetting('overlayEnabled', overlayToggle));

  // ============================================
  // SETTINGS MANAGEMENT
  // ============================================

  function loadSettings() {
    chrome.storage.local.get(['overlayEnabled'], (result) => {
      console.log('[Popup] Loaded settings:', result);

      setToggleState(overlayToggle, result.overlayEnabled !== false); // Default true

      updateBackendStatus();
    });
  }

  function toggleSetting(key, toggleEl) {
    const isActive = toggleEl.classList.contains('active');
    const newState = !isActive;

    setToggleState(toggleEl, newState);

    chrome.storage.local.set({ [key]: newState }, () => {
      console.log(`[Popup] Setting ${key} set to ${newState}`);

      // Notify content script about changes
      if (key === 'overlayEnabled') {
        notifyContentScript(newState ? 'showOverlay' : 'hideOverlay');
      }
    });
  }

  function setToggleState(toggleEl, isActive) {
    if (isActive) {
      toggleEl.classList.add('active');
    } else {
      toggleEl.classList.remove('active');
    }
  }

  function updateBackendStatus() {
    // Simulate backend status check (will be implemented in Phase 3)
    backendStatusEl.textContent = 'Not Connected';
    backendStatusEl.style.color = '#94a3b8';

    // In Phase 3, this will connect to WebSocket and show real status
    setTimeout(() => {
      backendStatusEl.textContent = 'Ready (Phase 1)';
      backendStatusEl.style.color = '#22c55e';
      lastSyncEl.textContent = new Date().toLocaleTimeString();
    }, 1000);
  }

  // ============================================
  // COMMUNICATION WITH CONTENT SCRIPT
  // ============================================

  function notifyContentScript(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: action }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Popup] Cannot send to content script (page may not be loaded):', chrome.runtime.lastError.message);
          } else {
            console.log('[Popup] Sent action to content script:', action);
          }
        });
      }
    });
  }

  // Update backend status periodically
  setInterval(updateBackendStatus, 30000);
});
