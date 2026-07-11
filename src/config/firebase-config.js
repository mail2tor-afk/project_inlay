import { initializeApp } from '../lib/firebase/firebase-app.js';
import { getAuth } from '../lib/firebase/firebase-auth.js';
import { getFirestore } from '../lib/firebase/firebase-firestore.js';

// Firebase configuration placeholders
// TODO: Replace with your actual Firebase project config
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

export { app, auth, db };
