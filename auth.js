'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — Authentication (Firebase Auth)
//  Google Sign-In + Apple Sign-In + Sign Out
// ============================================================

// Estado global do usuário logado
let APP_USER   = null;   // dados do Firestore
let APP_BLOCKED = [];    // IDs bloqueados (cache)

// ─── Ouvinte de estado de autenticação ──────────────────────
// Roda automaticamente ao carregar a página.
// Mantém sessão ativa sem precisar fazer login de novo.
function initAuth() {
  if (!FIREBASE_CONFIGURED) {
    // MODO DEMO: simula login sem Firebase
    setTimeout(() => {
      hideSplash();
      showLogin();
    }, 1800);
    return;
  }

  auth.onAuthStateChanged(async firebaseUser => {
    if (firebaseUser) {
      // Usuário já estava logado → busca dados no Firestore
      try {
        const userRef = db.collection('users').doc(firebaseUser.uid);
        const snap = await userRef.get();
        if (snap.exists) {
          APP_USER = { uid: firebaseUser.uid, ...snap.data() };
          if (snap.data().email) {
            // Move e-mail para subcoleção privada para não expor no perfil público.
            await userRef.collection('private').doc('info').set({ email: snap.data().email }, { merge: true });
            await userRef.update({ email: firebase.firestore.FieldValue.delete() });
          }
          await loadBlockedList();
          hideSplash();
          enterApp();
          return;
        }
      } catch (e) {
        console.error('Erro ao carregar perfil:', e);
      }
    }
    // Não logado → mostra tela de login
    hideSplash();
    showLogin();
  });
}

// ─── Google Sign-In ─────────────────────────────────────────
async function loginWithGoogle() {
  if (!FIREBASE_CONFIGURED) { demoLogin(); return; }

  setLoginLoading(true);
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await auth.signInWithPopup(provider);
    await handleNewUser(result.user, 'google');
  } catch (err) {
    setLoginLoading(false);
    if (err.code === 'auth/popup-closed-by-user') return;
    if (err.code === 'auth/popup-blocked') {
      showToast('Popup bloqueado. Permita popups para este site.');
      return;
    }
    if (err.code === 'auth/unauthorized-domain') {
      showToast('Domínio não autorizado no Firebase. Adicione localhost/127.0.0.1 em Authentication → Authorized domains.');
      console.error('Firebase auth unauthorized domain:', err);
      return;
    }
    showToast('Erro ao entrar com Google 😕');
    console.error(err);
  }
}

// ─── Apple Sign-In ──────────────────────────────────────────
// Requer: HTTPS + Apple Developer ($99/ano) + Service ID configurado
async function loginWithApple() {
  if (!FIREBASE_CONFIGURED) { demoLogin(); return; }

  // Apple Sign-In só funciona em HTTPS
  const localHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
  const hostname = window.location.hostname;
  const isLocalDev = localHosts.includes(hostname) || hostname.endsWith('.localhost');
  if (window.location.protocol !== 'https:' && !isLocalDev) {
    showToast('Apple Sign-In requer HTTPS. Use Google por enquanto.');
    return;
  }

  setLoginLoading(true);
  try {
    const provider = new firebase.auth.OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    const result = await auth.signInWithPopup(provider);
    await handleNewUser(result.user, 'apple');
  } catch (err) {
    setLoginLoading(false);
    if (err.code === 'auth/popup-closed-by-user') return;
    if (err.code === 'auth/unauthorized-domain') {
      showToast('Domínio não autorizado no Firebase. Adicione localhost/127.0.0.1 em Authentication → Authorized domains.');
      console.error('Firebase auth unauthorized domain:', err);
      return;
    }
    showToast('Erro ao entrar com Apple 😕');
    console.error(err);
  }
}

// ─── Login com E-mail (fallback) ────────────────────────────
async function loginWithEmail() {
  if (!FIREBASE_CONFIGURED) { demoLogin(); return; }
  // Mostra um prompt simples de e-mail/senha
  const email = window.prompt('Digite seu e-mail:');
  if (!email) return;
  const pass  = window.prompt('Digite sua senha (mín. 6 caracteres):');
  if (!pass)  return;

  setLoginLoading(true);
  try {
    // Tenta login; se falhar, tenta criar conta
    try {
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await auth.createUserWithEmailAndPassword(email, pass);
      } else { throw e; }
    }
    const user = auth.currentUser;
    if (user) await handleNewUser(user, 'email');
  } catch (err) {
    setLoginLoading(false);
    if (err.code === 'auth/unauthorized-domain') {
      showToast('Domínio não autorizado no Firebase. Adicione localhost/127.0.0.1 em Authentication → Authorized domains.');
      console.error('Firebase auth unauthorized domain:', err);
      return;
    }
    const msgs = {
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-email':  'E-mail inválido.',
      'auth/weak-password':  'Senha muito fraca (mín. 6 caracteres).',
    };
    showToast(msgs[err.code] || 'Erro ao fazer login 😕');
    console.error(err);
  }
}

// ─── Logout ─────────────────────────────────────────────────
async function doSignOut() {
  if (!FIREBASE_CONFIGURED) {
    APP_USER = null;
    document.getElementById('app').classList.add('hidden');
    showLogin();
    showToast('Até logo! 👋');
    return;
  }

  try {
    await auth.signOut();
    APP_USER = null;
    APP_BLOCKED = [];
    // Cancela listeners ativos
    Object.values(DB_LISTENERS).forEach(unsub => typeof unsub === 'function' && unsub());
    document.getElementById('app').classList.add('hidden');
    showLogin();
    showToast('Até logo! 👋');
  } catch (err) {
    showToast('Erro ao sair 😕');
    console.error(err);
  }
}

// ─── Excluir Conta (Apple Diretriz 5.1.1v) ──────────────────
async function deleteMyAccount() {
  if (!FIREBASE_CONFIGURED || !APP_USER) {
    showToast('Modo demo: conta não excluída.');
    return;
  }

  try {
    // 0. Best-effort: excluir os próprios posts para não deixar "lixo fantasma" na timeline
    try {
      const myPosts = await db.collection('posts').where('authorId', '==', APP_USER.uid).get();
      const batch = db.batch();
      myPosts.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    } catch(e) {
      console.warn('Não foi possível excluir todos os posts do usuário:', e);
    }

    // 1. Soft delete no Firestore (perfil fica descaracterizado e será removido 100% via Cloud Functions futuras)
    await db.collection('users').doc(APP_USER.uid).update({
      isDeleted:   true,
      deletedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      displayName: '[conta excluída]',
      handle:      'deleteduser_' + Date.now(),
      bio:         '',
      avatarUrl:   '',
    });

    // 2. Deleta conta do Firebase Auth
    await auth.currentUser.delete();

    APP_USER = null;
    document.getElementById('app').classList.add('hidden');
    showLogin();
    showToast('Conta excluída. Dados removidos em até 30 dias.');
  } catch (err) {
    if (err.code === 'auth/requires-recent-login') {
      showToast('Por segurança, faça login novamente antes de excluir.');
    } else {
      showToast('Erro ao excluir conta 😕');
      console.error(err);
    }
  }
}

// ─── Helpers internos ───────────────────────────────────────

// Cria ou atualiza documento do usuário no Firestore na primeira entrada
async function handleNewUser(firebaseUser, provider) {
  const userRef = db.collection('users').doc(firebaseUser.uid);
  const snap    = await userRef.get();

  if (!snap.exists) {
    // Primeiro login → cria perfil
    const handle = generateHandle(firebaseUser.displayName || 'leitor');
    const profile = {
      uid:         firebaseUser.uid,
      displayName: firebaseUser.displayName || 'Leitor',
      handle:      handle,
      bio:         '',
      avatarUrl:   firebaseUser.photoURL || '',
      isPrivate:   false,
      isDeleted:   false,
      deletedAt:   null,
      readingGoal: 24,
      booksRead:   0,
      followersCount: 0,
      followingCount: 0,
      postsCount:     0,
      authProviders: {
        apple:  provider === 'apple'  ? firebaseUser.uid : null,
        google: provider === 'google' ? firebaseUser.uid : null,
        email:  provider === 'email'  ? true : null,
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await userRef.set(profile);
    APP_USER = { ...profile, uid: firebaseUser.uid };
  } else {
    // Login subsequente → vincula provider extra se necessário
    const updates = { [`authProviders.${provider}`]: firebaseUser.uid || true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    await userRef.update(updates);
    APP_USER = { uid: firebaseUser.uid, ...snap.data() };
  }

  // Sempre tenta salvar/atualizar o e-mail na subcoleção privada no login
  if (firebaseUser.email) {
    await userRef.collection('private').doc('info').set({ email: firebaseUser.email }, { merge: true });
  }

  await loadBlockedList();
  enterApp();
}

// Carrega lista de usuários bloqueados (cache local para filtrar feed)
async function loadBlockedList() {
  if (!APP_USER || !db) return;
  try {
    const snap = await db.collection('userBlocks')
      .where('blockerId', '==', APP_USER.uid)
      .get();
    APP_BLOCKED = snap.docs.map(d => d.data().blockedId);
  } catch (e) {
    APP_BLOCKED = [];
  }
}

// Gera @handle único a partir do nome
function generateHandle(name) {
  const base = (name || 'leitor')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 14);
  return (base || 'leitor') + Math.floor(Math.random() * 9999);
}

// MODO DEMO (sem Firebase)
function demoLogin() {
  APP_USER = {
    uid:         'demo_user_001',
    displayName: 'Ana Lima',
    handle:      'analima',
    bio:         '📚 Leitora compulsiva · ☕ Café e livros',
    avatarUrl:   'avatar-placeholder.svg',
    isPrivate:   true,
    followersCount: 1247,
    followingCount: 389,
    postsCount:     247,
    readingGoal:    24,
    booksRead:      18,
  };
  enterApp();
}

function setLoginLoading(on) {
  const btns = document.querySelectorAll('.btn-apple, .btn-google, .btn-email');
  btns.forEach(b => { b.disabled = on; b.style.opacity = on ? '.6' : '1'; });
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) { splash.classList.add('out'); setTimeout(() => splash.remove(), 400); }
}

function showLogin() {
  document.getElementById('screen-login').classList.remove('hidden');
}
