'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — Firebase Initialization
//  Note: Firebase API keys are public by design in client apps.
//  The real security comes from Firebase Authentication and Firestore Rules.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyAKVV-duO2-YEPQClTXYxv5KVbsqnUyzIY",
  authDomain: "appcantinholiterario.firebaseapp.com",
  projectId: "appcantinholiterario",
  storageBucket: "appcantinholiterario.firebasestorage.app",
  messagingSenderId: "828410889269",
  appId: "1:828410889269:web:f3f9aadbb34780431f5d7c",
  measurementId: "G-BC43MZVHD6"
};

// Se a apiKey estiver preenchida de verdade, ativamos o Firebase.
const FIREBASE_CONFIGURED = firebaseConfig.apiKey && firebaseConfig.apiKey !== "COLE_SUA_API_KEY_AQUI";

// Testes automáticos: em localhost com ?emulador no endereço, o app usa os emuladores locais do
// Firebase (npm run test:e2e) e nunca toca no banco real.
const USE_EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('emulador');
if (USE_EMULATOR) firebaseConfig.projectId = 'demo-cantinho';

let app, auth, db, storage;

if (FIREBASE_CONFIGURED) {
  // Inicializa o Firebase (usando a versão compat para rodar via CDN sem build)
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  if (USE_EMULATOR) {
    auth.useEmulator('http://127.0.0.1:9099');
    db.useEmulator('127.0.0.1', 8080);
  }

  console.log("🔥 Firebase conectado com sucesso!");
} else {
  console.log("ℹ️ Firebase não configurado. Rodando no MODO DEMO (sem persistência).");
}
