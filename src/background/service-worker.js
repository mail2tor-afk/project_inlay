// Background Service Worker for Chrome Extension
// Handles OAuth, Authentication, and Message Routing

import { auth, db } from '../config/firebase-config.js';
import { signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged } from '../lib/firebase/firebase-auth.js';
import { doc, setDoc, getDoc, serverTimestamp } from '../lib/firebase/firebase-firestore.js';

let currentUser = null;
let guestMode = true;

// Listen for auth state changes to keep our local variable in sync
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    guestMode = false;
    console.log('[Background] Auth state changed: logged in as', user.email);
  } else {
    currentUser = null;
    guestMode = true;
    console.log('[Background] Auth state changed: logged out');
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message);
  
  if (message.action === 'login') {
    handleLogin().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'logout') {
    handleLogout().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  
  if (message.action === 'getUser') {
    // Make sure we have the latest token if needed, or just return currentUser
    sendResponse({ 
      user: currentUser ? {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL
      } : null, 
      isGuest: guestMode 
    });
    return false;
  }
  
  if (message.action === 'saveFactCheck') {
    saveFactCheckToFirestore(message.data).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  
  if (message.action === 'relayFetch') {
    fetch(message.url, {
      method: message.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: message.body ? JSON.stringify(message.body) : undefined
    })
    .then(res => res.text())
    .then(text => sendResponse({ success: true, data: text }))
    .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }
});

// Handle Google OAuth Login
async function handleLogin() {
  try {
    // 1. Get OAuth token from Chrome Identity
    const oauthToken = await getChromeIdentityToken();
    
    try {
      // Attempt Firebase Auth
      if (!auth || !auth.app || auth.app.options.apiKey === "YOUR_API_KEY") {
        throw new Error("Missing or placeholder Firebase API Key");
      }
      
      const credential = GoogleAuthProvider.credential(null, oauthToken);
      const userCredential = await signInWithCredential(auth, credential);
      currentUser = userCredential.user;
      guestMode = false;
      
      await saveUserDataToFirestore(currentUser);
      
      console.log('[Background] Login successful:', currentUser.email);
      return { 
        success: true, 
        user: { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName, photoURL: currentUser.photoURL },
        isGuest: false
      };
    } catch (fbError) {
      console.warn('[Background] Firebase Auth failed or not configured. Using Mock User fallback. Error:', fbError.message);
      
      // Fallback: Mock user info using Chrome Identity API
      const mockUser = {
        uid: 'mock-user-123',
        email: 'testuser@example.com',
        displayName: 'Test User',
        photoURL: ''
      };
      
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=' + oauthToken);
        const userInfo = await res.json();
        if (userInfo.id) {
          mockUser.uid = userInfo.id;
          mockUser.email = userInfo.email;
          mockUser.displayName = userInfo.name || userInfo.email;
          mockUser.photoURL = userInfo.picture || '';
        }
      } catch (e) {
         console.warn('[Background] Could not fetch Google user info, using default mock');
      }

      currentUser = mockUser;
      guestMode = false;
      return { success: true, user: mockUser, isGuest: false };
    }
  } catch (error) {
    console.error('[Background] Login failed completely:', error);
    guestMode = true;
    return { success: false, isGuest: true, error: error.message };
  }
}

// Get OAuth token using Chrome Identity API
function getChromeIdentityToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ 
      interactive: true,
      scopes: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]
    }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

// Save user data to Firestore
async function saveUserDataToFirestore(user) {
  try {
    const userRef = doc(db, 'users', user.uid);
    const userData = {
      email: user.email,
      displayName: user.displayName || 'Anonymous',
      photoURL: user.photoURL || '',
      subscription: 'free',
      settings: {
        theme: 'dark',
        overlayPosition: { x: 100, y: 100 },
        autoFactCheck: true
      },
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    };
    
    // Check if user exists
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      // Update only lastLoginAt
      await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
    } else {
      // Create new user document
      await setDoc(userRef, userData);
    }
  } catch (error) {
    console.error('[Background] Failed to save user data:', error);
    // Non-blocking error, user is still logged in
  }
}

// Handle Logout
async function handleLogout() {
  try {
    if (currentUser) {
      await signOut(auth);
      
      // We also should remove the cached token from Chrome Identity so it forces a fresh prompt if needed later
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, () => {
            console.log('[Background] Cleared Chrome Identity token');
          });
        }
      });
    }
    currentUser = null;
    guestMode = true;
    console.log('[Background] User logged out');
    return { success: true, isGuest: true };
  } catch (error) {
    console.error('[Background] Logout failed:', error);
    return { success: false, error: error.message };
  }
}

// Save fact-check result to Firestore
async function saveFactCheckToFirestore(data) {
  if (guestMode || !currentUser) {
    return { success: false, error: 'User not authenticated' };
  }
  
  try {
    const historyRef = doc(db, `users/${currentUser.uid}/history`, data.videoId);
    const historyData = {
      videoTitle: data.videoTitle,
      watchedAt: serverTimestamp(),
      factChecks: data.factChecks || [],
      votes: data.votes || {}
    };
    
    await setDoc(historyRef, historyData, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('[Background] Save fact-check failed:', error);
    return { success: false, error: error.message };
  }
}

console.log('[Background] Service worker initialized');
