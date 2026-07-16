/*
 * Real-time Video Fact-Check Overlay - Popup UI
 * Phase 1: The Shell (UI, Overlay & Manifest)
 * 
 * This is the popup interface that appears when clicking the extension icon.
 * Features:
 * - User authentication status (Login/Logout)
 * - Quick settings toggle
 * - Extension enable/disable control
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const authSection = document.getElementById('auth-section');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInfo = document.getElementById('user-info');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  const overlayToggle = document.getElementById('overlay-toggle');
  const guestBadge = document.getElementById('guest-badge');
  
  // State
  let currentUser = null;
  
  // Initialize
  init();
  
  async function init() {
    await loadUserState();
    setupEventListeners();
    loadSettings();
  }
  
  // ============================================
  // AUTHENTICATION
  // ============================================
  
  async function loadUserState() {
    try {
      // Check if user is logged in via Chrome storage
      const result = await chrome.storage.local.get(['user', 'isGuest']);
      
      if (result.user) {
        currentUser = result.user;
        showLoggedInUI(currentUser);
      } else if (result.isGuest) {
        showGuestUI();
      } else {
        showLoggedOutUI();
      }
    } catch (error) {
      console.error('[Popup] Error loading user state:', error);
      showLoggedOutUI();
    }
  }
  
  function showLoggedInUI(user) {
    authSection.classList.add('hidden');
    userInfo.classList.remove('hidden');
    
    userAvatar.src = user.photoURL || 'assets/default-avatar.png';
    userName.textContent = user.displayName || 'User';
    userEmail.textContent = user.email;
    
    if (guestBadge) {
      guestBadge.classList.add('hidden');
    }
  }
  
  function showGuestUI() {
    authSection.classList.add('hidden');
    userInfo.classList.remove('hidden');
    
    userAvatar.src = 'assets/guest-avatar.png';
    userName.textContent = 'Guest User';
    userEmail.textContent = 'Limited features';
    
    if (guestBadge) {
      guestBadge.classList.remove('hidden');
    }
  }
  
  function showLoggedOutUI() {
    authSection.classList.remove('hidden');
    userInfo.classList.add('hidden');
  }
  
  // ============================================
  // EVENT LISTENERS
  // ============================================
  
  function setupEventListeners() {
    // Login button
    loginBtn.addEventListener('click', handleLogin);
    
    // Logout button
    logoutBtn.addEventListener('click', handleLogout);
    
    // Overlay toggle
    overlayToggle.addEventListener('change', handleOverlayToggle);
  }
  
  async function handleLogin() {
    try {
      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in...';
      
      // Send message to background script to initiate OAuth
      const response = await chrome.runtime.sendMessage({
        action: 'loginWithGoogle'
      });
      
      if (response.success) {
        currentUser = response.user;
        showLoggedInUI(currentUser);
        
        // Save to storage
        await chrome.storage.local.set({
          user: currentUser,
          isGuest: false
        });
      } else {
        throw new Error(response.error || 'Login failed');
      }
    } catch (error) {
      console.error('[Popup] Login error:', error);
      alert(`Login failed: ${error.message}`);
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login with Google';
    }
  }
  
  async function handleLogout() {
    try {
      // Send message to background script to logout
      await chrome.runtime.sendMessage({
        action: 'logout'
      });
      
      // Clear local state
      currentUser = null;
      await chrome.storage.local.set({
        user: null,
        isGuest: false
      });
      
      showLoggedOutUI();
    } catch (error) {
      console.error('[Popup] Logout error:', error);
      alert(`Logout failed: ${error.message}`);
    }
  }
  
  async function handleOverlayToggle(e) {
    const isEnabled = e.target.checked;
    
    // Save setting
    await chrome.storage.local.set({
      overlayEnabled: isEnabled
    });
    
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: isEnabled ? 'showOverlay' : 'hideOverlay'
        });
      }
    });
  }
  
  // ============================================
  // SETTINGS
  // ============================================
  
  async function loadSettings() {
    const result = await chrome.storage.local.get(['overlayEnabled']);
    
    if (overlayToggle) {
      overlayToggle.checked = result.overlayEnabled !== false; // Default to true
    }
  }
});
