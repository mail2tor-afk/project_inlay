/*
 * Real-time Video Fact-Check Overlay - Background Service Worker
 * Phase 1: The Shell (UI, Overlay & Manifest)
 * 
 * This service worker handles:
 * - OAuth authentication with Google
 * - Message routing between popup and content scripts
 * - Extension lifecycle management
 */

// ============================================
// STATE MANAGEMENT
// ============================================

let authState = {
  isAuthenticated: false,
  user: null,
  token: null
};

// ============================================
// MESSAGE LISTENERS
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ServiceWorker] Received message:', message);
  
  switch (message.action) {
    case 'loginWithGoogle':
      handleLogin(message)
        .then(response => sendResponse(response))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response
    
    case 'logout':
      handleLogout()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    
    case 'getUser':
      sendResponse({ 
        success: true, 
        user: authState.user,
        isAuthenticated: authState.isAuthenticated 
      });
      break;
    
    case 'showOverlay':
      forwardToContentScript(sender.tab?.id, { action: 'showOverlay' });
      sendResponse({ success: true });
      break;
    
    case 'hideOverlay':
      forwardToContentScript(sender.tab?.id, { action: 'hideOverlay' });
      sendResponse({ success: true });
      break;
    
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// ============================================
// AUTHENTICATION HANDLERS
// ============================================

async function handleLogin(message) {
  try {
    // Use Chrome Identity API to get Google OAuth token
    const redirectUri = chrome.identity.getRedirectURL();
    
    // Build OAuth URL
    const oauthUrl = buildOAuthUrl(redirectUri);
    
    // Launch auth session
    const responseUrl = await launchAuthSession(oauthUrl);
    
    // Extract token from response
    const params = new URLSearchParams(responseUrl.hash.substring(1));
    const accessToken = params.get('access_token');
    
    if (!accessToken) {
      throw new Error('No access token received');
    }
    
    // Get user info from Google
    const userInfo = await fetchUserInfo(accessToken);
    
    // Update auth state
    authState = {
      isAuthenticated: true,
      user: {
        uid: userInfo.sub,
        email: userInfo.email,
        displayName: userInfo.name,
        photoURL: userInfo.picture
      },
      token: accessToken
    };
    
    // Save to storage for persistence
    await chrome.storage.local.set({
      user: authState.user,
      isGuest: false
    });
    
    console.log('[ServiceWorker] Login successful:', authState.user.email);
    
    return {
      success: true,
      user: authState.user
    };
    
  } catch (error) {
    console.error('[ServiceWorker] Login failed:', error);
    throw error;
  }
}

async function handleLogout() {
  try {
    // Clear auth state
    authState = {
      isAuthenticated: false,
      user: null,
      token: null
    };
    
    // Clear storage
    await chrome.storage.local.set({
      user: null,
      isGuest: false
    });
    
    console.log('[ServiceWorker] Logout successful');
    
    return { success: true };
    
  } catch (error) {
    console.error('[ServiceWorker] Logout failed:', error);
    throw error;
  }
}

// ============================================
// OAUTH HELPERS
// ============================================

function buildOAuthUrl(redirectUri) {
  const clientId = 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com'; // Replace with actual client ID
  const scopes = ['openid', 'email', 'profile'];
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: scopes.join(' '),
    include_granted_scopes: 'true'
  });
  
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function launchAuthSession(authUrl) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true
      },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(responseUrl);
        }
      }
    );
  });
}

async function fetchUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }
  
  return await response.json();
}

// ============================================
// MESSAGE FORWARDING
// ============================================

function forwardToContentScript(tabId, message) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, message).catch(error => {
      console.warn('[ServiceWorker] Failed to send message to content script:', error);
    });
  }
}

// ============================================
// LIFECYCLE EVENTS
// ============================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ServiceWorker] Extension installed:', details.reason);
  
  if (details.reason === 'install') {
    // Initialize default settings
    chrome.storage.local.set({
      overlayEnabled: true,
      autoFactCheck: true,
      overlayPosition: { x: 20, y: 100 },
      overlaySize: { width: 400, height: 500 }
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[ServiceWorker] Extension started up');
  
  // Restore auth state from storage if needed
  restoreAuthState();
});

async function restoreAuthState() {
  try {
    const result = await chrome.storage.local.get(['user', 'isGuest']);
    
    if (result.user && !result.isGuest) {
      authState = {
        isAuthenticated: true,
        user: result.user,
        token: null // Token needs to be refreshed
      };
      console.log('[ServiceWorker] Auth state restored for:', authState.user.email);
    }
  } catch (error) {
    console.error('[ServiceWorker] Failed to restore auth state:', error);
  }
}

// ============================================
// CONTEXT MENU (Optional - for future use)
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items for future features
  chrome.contextMenus.create({
    id: 'factcheck-selection',
    title: 'Fact-check this claim',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'factcheck-selection' && info.selectionText) {
    console.log('[ServiceWorker] Fact-check selection:', info.selectionText);
    
    // Send selected text to content script for fact-checking
    chrome.tabs.sendMessage(tab.id, {
      action: 'factCheckSelection',
      text: info.selectionText
    });
  }
});

console.log('[ServiceWorker] Service worker initialized');
