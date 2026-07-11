// Background Service Worker for Chrome Extension
// Handles OAuth, Authentication, and Message Routing

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// TODO: Replace with your Firebase config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let guestMode = true;

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
    sendResponse({ user: currentUser, isGuest: guestMode });
    return false;
  }
  
  if (message.action === 'saveFactCheck') {
    saveFactCheckToFirestore(message.data).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// Handle Google OAuth Login
async function handleLogin() {
  try {
    // Get OAuth token from Chrome Identity
    const oauthToken = await getChromeIdentityToken();
    
    // Exchange OAuth token for Firebase custom token (you need a backend for this in production)
    // For now, we'll simulate a successful login
    const mockUid = 'user_' + Math.random().toString(36).substr(2, 9);
    const mockCustomToken = await createMockCustomToken(mockUid);
    
    // Sign in to Firebase
    const userCredential = await signInWithCustomToken(auth, mockCustomToken);
    currentUser = userCredential.user;
    guestMode = false;
    
    // Save/update user data in Firestore
    await saveUserDataToFirestore(currentUser);
    
    console.log('[Background] Login successful:', currentUser.email);
    return { 
      success: true, 
      user: {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL
      },
      isGuest: false
    };
  } catch (error) {
    console.error('[Background] Login failed:', error);
    // Fallback to guest mode
    guestMode = true;
    return { success: false, isGuest: true, error: error.message };
  }
}

// Get OAuth token using Chrome Identity API
function getChromeIdentityToken() {
  return new Promise((resolve, reject) => {
    // TODO: Replace with your actual Client ID from Google Cloud Console
    const clientId = 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com';
    
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

// Mock function to create custom token (replace with backend call in production)
async function createMockCustomToken(uid) {
  // In production, call your backend to create a real Firebase Custom Token
  // This is just for development/testing
  return uid; // Simplified for demo
}

// Save user data to Firestore
async function saveUserDataToFirestore(user) {
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
}

// Handle Logout
async function handleLogout() {
  try {
    if (!guestMode && currentUser) {
      await signOut(auth);
      // Clear cached OAuth token
      chrome.identity.removeCachedAuthToken({ token: currentUser.accessToken }, () => {});
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

// Listen for token changes (e.g., token expiration)
chrome.identity.onTokenRemoved.addListener((details) => {
  console.log('[Background] Token removed:', details);
  if (details.interactive) {
    handleLogout();
  }
});

console.log('[Background] Service worker initialized');
