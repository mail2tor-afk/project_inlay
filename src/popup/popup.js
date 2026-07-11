// Popup Script: Handles UI interactions and communication with background script

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] Initialized');
  
  // UI Elements
  const loadingView = document.getElementById('loadingView');
  const guestView = document.getElementById('guestView');
  const loggedInView = document.getElementById('loggedInView');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userNameEl = document.getElementById('userName');
  const userEmailEl = document.getElementById('userEmail');
  const userAvatarEl = document.getElementById('userAvatar');
  
  // Toggle buttons
  const overlayToggle = document.getElementById('overlayToggle');
  const autoFactCheckToggle = document.getElementById('autoFactCheckToggle');
  const livePollsToggle = document.getElementById('livePollsToggle');
  const themeToggle = document.getElementById('themeToggle');
  
  // Status elements
  const backendStatusEl = document.getElementById('backendStatus');
  const lastSyncEl = document.getElementById('lastSync');

  // Load settings from storage
  loadSettings();

  // Get current user state
  getCurrentUser();

  // Event Listeners
  loginBtn.addEventListener('click', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  
  overlayToggle.addEventListener('click', () => toggleSetting('overlayEnabled', overlayToggle));
  autoFactCheckToggle.addEventListener('click', () => toggleSetting('autoFactCheck', autoFactCheckToggle));
  livePollsToggle.addEventListener('click', () => toggleSetting('livePollsEnabled', livePollsToggle));
  themeToggle.addEventListener('click', () => toggleSetting('darkTheme', themeToggle));

  // ============================================
  // AUTHENTICATION FUNCTIONS
  // ============================================

  function getCurrentUser() {
    chrome.runtime.sendMessage({ action: 'getUser' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Error getting user:', chrome.runtime.lastError);
        showGuestView();
        return;
      }
      
      console.log('[Popup] User response:', response);
      
      if (response && response.user && !response.isGuest) {
        showLoggedInView(response.user);
      } else {
        showGuestView();
      }
    });
  }

  function handleLogin() {
    console.log('[Popup] Login clicked');
    setLoading(true);
    
    chrome.runtime.sendMessage({ action: 'login' }, (response) => {
      setLoading(false);
      
      if (chrome.runtime.lastError) {
        console.error('[Popup] Login error:', chrome.runtime.lastError);
        alert('Login failed: ' + chrome.runtime.lastError.message);
        return;
      }
      
      console.log('[Popup] Login response:', response);
      
      if (response && response.success && !response.isGuest) {
        showLoggedInView(response.user);
      } else {
        // Stay in guest mode
        showGuestView();
        if (response && response.error) {
          alert('Login failed: ' + response.error);
        }
      }
    });
  }

  function handleLogout() {
    console.log('[Popup] Logout clicked');
    
    chrome.runtime.sendMessage({ action: 'logout' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Logout error:', chrome.runtime.lastError);
      }
      
      console.log('[Popup] Logout response:', response);
      showGuestView();
    });
  }

  // ============================================
  // UI STATE FUNCTIONS
  // ============================================

  function showLoadingView() {
    loadingView.classList.remove('hidden');
    guestView.classList.add('hidden');
    loggedInView.classList.add('hidden');
  }

  function showGuestView() {
    loadingView.classList.add('hidden');
    guestView.classList.remove('hidden');
    loggedInView.classList.add('hidden');
  }

  function showLoggedInView(user) {
    loadingView.classList.add('hidden');
    guestView.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    
    userNameEl.textContent = user.displayName || 'User';
    userEmailEl.textContent = user.email || '';
    
    if (user.photoURL) {
      userAvatarEl.style.backgroundImage = `url(${user.photoURL})`;
      userAvatarEl.style.backgroundSize = 'cover';
      userAvatarEl.textContent = '';
    } else {
      userAvatarEl.textContent = (user.displayName || 'U').charAt(0).toUpperCase();
    }
  }

  function setLoading(isLoading) {
    if (isLoading) {
      showLoadingView();
    } else {
      getCurrentUser();
    }
  }

  // ============================================
  // SETTINGS MANAGEMENT
  // ============================================

  function loadSettings() {
    chrome.storage.local.get(['overlayEnabled', 'autoFactCheck', 'livePollsEnabled', 'darkTheme'], (result) => {
      console.log('[Popup] Loaded settings:', result);
      
      setToggleState(overlayToggle, result.overlayEnabled !== false); // Default true
      setToggleState(autoFactCheckToggle, result.autoFactCheck !== false); // Default true
      setToggleState(livePollsToggle, result.livePollsEnabled === true); // Default false
      setToggleState(themeToggle, result.darkTheme !== false); // Default true
      
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
