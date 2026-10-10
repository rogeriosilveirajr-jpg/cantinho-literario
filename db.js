'use strict';
// ============================================================
//  CANTINHO LITERÁRIO — Firestore Database Operations
//  Feed · Posts · Likes · Comments · Follow · Report · Block
// ============================================================

const DB_LISTENERS  = {};  // listeners ativos (para cancelar ao navegar)
let   FEED_LAST_DOC = null;
let   FEED_LOADING  = false;
let   CURRENT_POST_ID = null;  // post aberto no modal de comentários

// ════════════════════════════════════════════════════════════
//  FEED
// ════════════════════════════════════════════════════════════

function loadFeed(refresh = false) {
  const container = document.getElementById('view-feed');
  if (!container) return;

  if (refresh) {
    FEED_LAST_DOC = null;
    container.innerHTML = '';
    renderFeedSkeleton(container);
  }

  if (!FIREBASE_CONFIGURED) {
    renderDemoFeed();
    return;
  }

  if (FEED_LOADING) return;
  FEED_LOADING = true;

  // As regras de segurança só liberam a busca geral de posts públicos.
  let q = db.collection('posts')
    .where('isPrivate', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(20);

  if (FEED_LAST_DOC) q = q.startAfter(FEED_LAST_DOC);

  q.get()
    .then(snap => {
      FEED_LOADING = false;
      container.querySelector('.skeleton-wrap')?.remove();

      if (snap.empty && !FEED_LAST_DOC) {
        container.innerHTML = emptyFeedHtml();
        return;
      }
      FEED_LAST_DOC = snap.docs[snap.docs.length - 1] || FEED_LAST_DOC;
      
      const renderPromises = snap.docs.map(async doc => {
        const data = doc.data();
        
        let currentTab = typeof CURRENT_FEED_TAB !== 'undefined' ? CURRENT_FEED_TAB : 'normal';
        if (currentTab === 'trade' && data.postType !== 'trade') return null;
        
        if (APP_BLOCKED.includes(data.authorId)) return null;
        if (data.isNotification) return null; 
        
        if (data.isPrivate && (!APP_USER || data.authorId !== APP_USER.uid)) {
           const followId = APP_USER ? `${APP_USER.uid}_${data.authorId}` : `null_${data.authorId}`;
           try {
             const fSnap = await db.collection('followGraph').doc(followId).get();
             if (!fSnap.exists || fSnap.data().status !== 'ACCEPTED') return null;
           } catch (e) {
             console.warn('Não foi possível verificar followGraph para post privado:', e);
             return null;
           }
        }
        return { doc, data };
      });
      
      Promise.all(renderPromises)
        .then(results => {
          results.forEach(res => {
            if (!res) return;
            container.insertAdjacentHTML('beforeend', buildPostCard(res.doc.id, res.data));
            const btn = container.querySelector(`.post-card[data-post-id="${res.doc.id}"] .pill-like`);
            if (btn) {
              checkLiked(res.doc.id, btn).catch(err => console.error('Erro ao verificar like:', err));
            }
          });
        })
        .catch(err => {
          console.error('Feed render error:', err);
        });
    })
    .catch(err => {
      FEED_LOADING = false;
      console.error('Feed error:', err);
      container.querySelector('.skeleton-wrap')?.remove();
      container.innerHTML = '<p style="text-align:center;color:#B0A090;padding:40px">Erro ao carregar feed 😕<br/><button onclick="loadFeed(true)" style="margin-top:12px;color:#C8714A;font-weight:600">Tentar novamente</button></p>';
    });
}

function subscribeNewPosts() {
  if (!FIREBASE_CONFIGURED) return;
  if (DB_LISTENERS.newPosts) DB_LISTENERS.newPosts();

  const ref = db.collection('posts')
    .where('isPrivate', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(1);

  let first = true;
  DB_LISTENERS.newPosts = ref.onSnapshot(async snap => {
    if (first) { first = false; return; }  
    for (const change of snap.docChanges()) {
      if (change.type === 'added') {
        const data = change.doc.data();
        
        let currentTab = typeof CURRENT_FEED_TAB !== 'undefined' ? CURRENT_FEED_TAB : 'normal';
        if (currentTab === 'trade' && data.postType !== 'trade') continue;
        
        if (APP_BLOCKED.includes(data.authorId)) continue;
        
        if (data.isPrivate && (!APP_USER || data.authorId !== APP_USER.uid)) {
           const followId = APP_USER ? `${APP_USER.uid}_${data.authorId}` : `null_${data.authorId}`;
           try {
             const fSnap = await db.collection('followGraph').doc(followId).get();
             if (!fSnap.exists || fSnap.data().status !== 'ACCEPTED') continue;
           } catch (e) {
             console.warn('Não foi possível verificar followGraph para nova publicação privada:', e);
             continue;
           }
        }
        
        const container = document.getElementById('view-feed');
        if (container) container.insertAdjacentHTML('afterbegin', buildPostCard(change.doc.id, data));
      }
    }
  });
}

// ════════════════════════════════════════════════════════════
//  CRIAR POST
// ════════════════════════════════════════════════════════════

async function submitPost(text, base64Image = null) {
  if (!text.trim() && !base64Image) { showToast('Escreva algo ou adicione uma foto! ✍️'); return false; }
  if (!APP_USER)    { showToast('Faça login para publicar'); return false; }

  if (!FIREBASE_CONFIGURED) {
    const demoPost = {
      authorId: APP_USER.uid,
      authorSnap: { handle: APP_USER.handle, displayName: APP_USER.displayName, avatarUrl: APP_USER.avatarUrl || '' },
      text,
      imageUrls: [],
      bookSnap: null,
      likesCount: 0,
      commentsCount: 0,
      createdAt: { toDate: () => new Date() },
    };
    const container = document.getElementById('view-feed');
    if (container) container.insertAdjacentHTML('afterbegin', buildPostCard('demo_' + Date.now(), demoPost));
    return true;
  }

  try {
    const post = {
      authorId: APP_USER.uid,
      authorSnap: {
        handle:      APP_USER.handle,
        displayName: APP_USER.displayName,
        avatarUrl:   APP_USER.avatarUrl || '',
      },
      type:          'feed',
      text:          text ? text.trim() : '',
      imageUrls:     base64Image ? [base64Image] : [],
      bookSnap:      null,
      likesCount:    0,
      commentsCount: 0,
      isPrivate:     APP_USER.isPrivate || false,
      isDeleted:     false,
      deletedAt:     null,
      createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('posts').add(post);
    await db.collection('users').doc(APP_USER.uid).update({
      postsCount: firebase.firestore.FieldValue.increment(1),
    });
    return true;
  } catch (err) {
    showToast('Erro ao publicar 😕');
    console.error(err);
    return false;
  }
}

// ════════════════════════════════════════════════════════════
//  LIKES
// ════════════════════════════════════════════════════════════

async function toggleLikeDB(postId, btn) {
  if (!APP_USER) { showToast('Faça login para curtir'); return; }

  const isLiked = btn.getAttribute('data-liked') === 'true';
  setLikeUI(btn, !isLiked);
  btn.setAttribute('data-liked', String(!isLiked));

  if (!FIREBASE_CONFIGURED) return;

  try {
    const postRef = db.collection('posts').doc(postId);
    const likeRef = postRef.collection('likes').doc(APP_USER.uid);
    const targetId = btn.closest('.post-card')?.getAttribute('data-author-id');

    if (isLiked) {
      await likeRef.delete();
      await postRef.update({ likesCount: firebase.firestore.FieldValue.increment(-1) });
    } else {
      await likeRef.set({ userId: APP_USER.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await postRef.update({ likesCount: firebase.firestore.FieldValue.increment(1) });
      
      if (targetId) {
        await createNotification(targetId, 'like', `❤️ <b>${APP_USER.displayName}</b> curtiu sua publicação.`, postId);
      }
      spawnHeart(btn);
    }
  } catch (err) {
    setLikeUI(btn, isLiked);
    btn.setAttribute('data-liked', String(isLiked));
    console.error('Like error:', err);
  }
}

async function checkLiked(postId, btn) {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  try {
    const snap = await db.collection('posts').doc(postId).collection('likes').doc(APP_USER.uid).get();
    if (snap.exists) {
      btn.setAttribute('data-liked', 'true');
      setLikeUI(btn, true);
    }
  } catch (err) {
    console.error('Erro ao verificar se o post foi curtido:', err);
  }
}

function setLikeUI(btn, liked) {
  const icon = btn.querySelector('.like-icon');
  if (liked) {
    btn.style.background = '#B02020';
    btn.setAttribute('aria-pressed', 'true');
    if (icon) { icon.setAttribute('fill', 'white'); icon.removeAttribute('stroke'); icon.removeAttribute('stroke-width'); }
  } else {
    btn.style.background = '';
    btn.setAttribute('aria-pressed', 'false');
    if (icon) { icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '2.2'); }
  }
}

// ════════════════════════════════════════════════════════════
//  COMENTÁRIOS
// ════════════════════════════════════════════════════════════

function openCommentsFor(postId) {
  CURRENT_POST_ID = postId;
  openSheet('sh-comments');
  loadComments(postId);
}

function loadComments(postId) {
  const list = document.querySelector('.comments-list');
  if (!list) return;
  list.innerHTML = '<p style="color:#B0A090;font-size:.82rem;text-align:center;padding:20px">Carregando...</p>';

  if (!FIREBASE_CONFIGURED) {
    list.innerHTML = `
      ${buildCommentHtml('Pedro Alves', 'avatar2.jpg', 'Que leitura incrível! 🌿', '2h')}
      ${buildCommentHtml('Irene Carvalho', 'avatar3.jpg', 'Estou na terceira releitura! ✨', '3h')}`;
    return;
  }

  if (DB_LISTENERS.comments) { DB_LISTENERS.comments(); delete DB_LISTENERS.comments; }

  DB_LISTENERS.comments = db.collection('posts').doc(postId)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<p style="color:#B0A090;font-size:.82rem;text-align:center;padding:20px">Seja o primeiro a comentar!</p>';
        return;
      }
      snap.docs.forEach(doc => {
        const d = doc.data();
        list.insertAdjacentHTML('beforeend',
          buildCommentHtml(d.authorSnap?.displayName || 'Leitor', d.authorSnap?.avatarUrl || 'avatar-placeholder.svg', d.text, timeAgo(d.createdAt?.toDate())));
      });
      list.scrollTop = list.scrollHeight;
    }, err => {
      console.error('Comments error:', err);
      list.innerHTML = '<p style="text-align:center;color:#B0A090;padding:20px">Erro ao carregar comentários</p>';
    });
}

async function submitComment(text) {
  if (!APP_USER)            { showToast('Faça login para comentar'); return; }
  if (!text.trim())         { showToast('Escreva um comentário'); return; }
  if (!CURRENT_POST_ID)     return;

  if (!FIREBASE_CONFIGURED) {
    const list = document.querySelector('.comments-list');
    if (list) list.insertAdjacentHTML('beforeend', buildCommentHtml(APP_USER.displayName, APP_USER.avatarUrl || 'avatar-placeholder.svg', text, 'agora'));
    showToast('Comentário enviado! 💬');
    return;
  }

  try {
    const postRef = db.collection('posts').doc(CURRENT_POST_ID);
    
    await postRef.collection('comments').add({
      authorId:  APP_USER.uid,
      authorSnap: { handle: APP_USER.handle, displayName: APP_USER.displayName, avatarUrl: APP_USER.avatarUrl || '' },
      text:      text.trim(),
      likesCount: 0,
      isDeleted: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    
    await postRef.update({
      commentsCount: firebase.firestore.FieldValue.increment(1),
    });

    const postSnap = await postRef.get();
    if (postSnap.exists) {
      await createNotification(postSnap.data().authorId, 'comment', `💬 <b>${APP_USER.displayName}</b> comentou: "${text.trim().substring(0, 30)}${text.trim().length > 30 ? '...' : ''}"`, CURRENT_POST_ID);
    }
  } catch (err) {
    showToast('Erro ao comentar 😕');
    console.error(err);
  }
}

// ════════════════════════════════════════════════════════════
//  FOLLOW / UNFOLLOW
// ════════════════════════════════════════════════════════════

async function followUserDB(targetId, targetBtn) {
  if (!APP_USER)              { showToast('Faça login para seguir'); return; }
  if (targetId === APP_USER.uid) return;

  if (!FIREBASE_CONFIGURED) {
    showToast('Seguindo! ✓');
    if (targetBtn) { targetBtn.textContent = 'Seguindo'; targetBtn.style.background = 'var(--bg)'; targetBtn.style.color = 'var(--ink)'; }
    return;
  }

  try {
    const followId  = `${APP_USER.uid}_${targetId}`;
    const followRef = db.collection('followGraph').doc(followId);
    const existing  = await followRef.get();
    if (existing.exists && existing.data().status !== 'NONE') {
      showToast('Você já segue este usuário');
      return;
    }

    const targetDoc = await db.collection('users').doc(targetId).get();
    const isPrivate = targetDoc.data()?.isPrivate || false;

    await followRef.set({
      followerId: APP_USER.uid,
      followedId: targetId,
      status:     isPrivate ? 'PENDING' : 'ACCEPTED',
      createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
    });

    if (!isPrivate) {
      try { await db.collection('users').doc(targetId).update({ followersCount: firebase.firestore.FieldValue.increment(1) }); } catch(e){}
      try { await db.collection('users').doc(APP_USER.uid).update({ followingCount: firebase.firestore.FieldValue.increment(1) }); } catch(e){}
      APP_USER.followingCount = (APP_USER.followingCount || 0) + 1;
    }

    if (isPrivate) {
      createNotification(targetId, 'follow_request', `🔔 <b>${APP_USER.displayName}</b> pediu para seguir você.`);
    }

    const msg = isPrivate ? 'Pedido de seguir enviado 📨' : 'Seguindo! ✓';
    showToast(msg);
    if (targetBtn) { 
      targetBtn.textContent = isPrivate ? 'Solicitado' : 'Seguindo'; 
      targetBtn.style.background = '#F0E8D6';
      targetBtn.style.color = '#8A7060';
      targetBtn.setAttribute('data-following', 'true');
    }
    
    if (!isPrivate) {
      createNotification(targetId, 'follow', `👋 <b>${APP_USER.displayName}</b> começou a seguir você.`);
      const fc = document.getElementById('up-followers-count');
      if (fc && !document.getElementById('sh-user-profile').classList.contains('hidden')) {
         fc.textContent = parseInt(fc.textContent || 0) + 1;
      }
    }
  } catch (err) {
    showToast('Erro ao seguir 😕');
    console.error(err);
  }
}

async function unfollowUserDB(targetId, targetBtn) {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  try {
    const followId = `${APP_USER.uid}_${targetId}`;
    const followRef = db.collection('followGraph').doc(followId);
    const existing = await followRef.get();
    
    if (existing.exists) {
      const data = existing.data();
      await followRef.delete();
      
      if (data.status === 'ACCEPTED') {
        try { await db.collection('users').doc(targetId).update({ followersCount: firebase.firestore.FieldValue.increment(-1) }); } catch(e){}
        try { await db.collection('users').doc(APP_USER.uid).update({ followingCount: firebase.firestore.FieldValue.increment(-1) }); } catch(e){}
        APP_USER.followingCount = Math.max(0, (APP_USER.followingCount || 0) - 1);
        
        const fc = document.getElementById('up-followers-count');
        if (fc && !document.getElementById('sh-user-profile').classList.contains('hidden')) {
           fc.textContent = Math.max(0, parseInt(fc.textContent || 0) - 1);
        }
      }
      
      showToast('Deixou de seguir');
      if (targetBtn) {
        targetBtn.textContent = 'Seguir';
        targetBtn.style.background = 'transparent';
        targetBtn.style.color = '#C8714A';
        targetBtn.setAttribute('data-following', 'false');
      }
    }
  } catch (err) {
    console.error('Erro ao deixar de seguir:', err);
  }
}

async function toggleFollow(btn, targetId) {
  const isFollowing = btn.getAttribute('data-following') === 'true';
  if (isFollowing) {
    btn.textContent = 'Deixando...';
    await unfollowUserDB(targetId, btn);
  } else {
    btn.textContent = 'Seguindo...';
    await followUserDB(targetId, btn);
  }
}

// ════════════════════════════════════════════════════════════
//  MEU PERFIL & MEUS POSTS
// ════════════════════════════════════════════════════════════

function renderMyProfile() {
  if (!APP_USER) return;

  // 1. Atualiza Avatar
  const avatarUrl = APP_USER.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(APP_USER.displayName || 'U') + '&background=E8A048&color=fff');
  document.querySelectorAll('#profile-av-img, #ep-av-img, #my-tnav-avatar').forEach(el => el.src = avatarUrl);
  
  // 2. Atualiza Capa (Lógica corrigida)
  const coverImg = document.getElementById('profile-cover-img');
  const epCover = document.getElementById('ep-cover-img');
  
  if (APP_USER.coverUrl && APP_USER.coverUrl.trim() !== '') {
    if (coverImg) { coverImg.src = APP_USER.coverUrl; coverImg.style.display = 'block'; }
    if (epCover) { epCover.src = APP_USER.coverUrl; epCover.style.display = 'block'; }
  } else {
    // Se não tem foto, esconde a img para mostrar o fundo padrão do CSS
    if (coverImg) coverImg.style.display = 'none';
    if (epCover) epCover.style.display = 'none';
  }


  const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.innerHTML = val || ''; };
  set('.profile-name', APP_USER.displayName || 'Usuário');
  set('.profile-handle', '@' + (APP_USER.handle || APP_USER.uid.slice(0,8)));
  set('.profile-top-handle', '@' + (APP_USER.handle || APP_USER.uid.slice(0,8)));
  
  let bio = APP_USER.bio || 'Adicione uma bio...';
  if (APP_USER.city) bio += ` · ${APP_USER.city}`;
  set('.profile-bio', bio);
  set('.profile-now', APP_USER.nowReading ? `📖 Lendo: <em>${APP_USER.nowReading}</em>` : '');

  const stats = document.querySelectorAll('.p-stat strong');
  if (stats[0]) stats[0].textContent = APP_USER.postsCount || 0;
  
  if (FIREBASE_CONFIGURED) {
    db.collection('followGraph').where('followedId', '==', APP_USER.uid).get()
      .then(snap => {
        if (stats[1]) stats[1].textContent = snap.docs.filter(d => d.data().status === 'ACCEPTED').length;
      })
      .catch(err => {
        console.error('Erro ao carregar seguidores do perfil:', err);
      });
    db.collection('followGraph').where('followerId', '==', APP_USER.uid).get()
      .then(snap => {
        if (stats[2]) stats[2].textContent = snap.docs.filter(d => d.data().status === 'ACCEPTED').length;
      })
      .catch(err => {
        console.error('Erro ao carregar seguindo do perfil:', err);
      });
  } else {
    if (stats[1]) stats[1].textContent = APP_USER.followersCount || 0;
    if (stats[2]) stats[2].textContent = APP_USER.followingCount || 0;
  }

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; }
  setVal('ep-name', APP_USER.displayName);
  setVal('ep-city', APP_USER.city);
  setVal('ep-bio', APP_USER.bio);
  setVal('ep-handle', APP_USER.handle);
  setVal('ep-now', APP_USER.nowReading);
  setVal('ep-genres', APP_USER.genres ? APP_USER.genres.join(', ') : '');
  const isPrivEl = document.getElementById('ep-private');
  if (isPrivEl) isPrivEl.checked = APP_USER.isPrivate || false;
  const isPrivSetEl = document.getElementById('ep-private-settings');
  if (isPrivSetEl) isPrivSetEl.checked = APP_USER.isPrivate || false;

  const cbAv = document.getElementById('compose-bar-av');
  if (cbAv) cbAv.src = APP_USER.avatarUrl || 'avatar-placeholder.svg';

  const genresContainer = document.getElementById('profile-genres-container');
  if (genresContainer) {
    if (APP_USER.genres && APP_USER.genres.length > 0) {
      genresContainer.innerHTML = APP_USER.genres.map(g => 
        `<span style="color:#C64747; background:#FCEEEB; padding:4px 12px; border-radius:16px; font-size:0.8rem; font-weight:bold; display:inline-block; margin-right:6px; margin-bottom:6px;">${escHtml(g)}</span>`
      ).join('');
    } else {
      genresContainer.innerHTML = '<span style="color:#8A7060; font-size:0.8rem;">Nenhum gênero adicionado.</span>';
    }
  }

  loadMyPosts();
}

async function saveProfileEdits() {
  if (!APP_USER) return;
  
  const saveBtn = document.querySelector('#sh-edit-profile .sh-action');
  const btnOriginalText = saveBtn ? saveBtn.textContent : 'Salvar';
  if (saveBtn) { saveBtn.textContent = 'Salvando...'; saveBtn.style.opacity = '0.7'; saveBtn.disabled = true; }

  if (typeof setLoginLoading === 'function') setLoginLoading(true);
  try {
    const name = document.getElementById('ep-name')?.value;
    const city = document.getElementById('ep-city')?.value;
    const handle = document.getElementById('ep-handle')?.value;
    const bio = document.getElementById('ep-bio')?.value;
    const now = document.getElementById('ep-now')?.value;
    const genresStr = document.getElementById('ep-genres')?.value;
    const isPrivate = document.getElementById('ep-private')?.checked;

    const updates = {};
    if (name !== undefined) updates.displayName = name;
    if (handle !== undefined) {
      let cleanHandle = handle.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanHandle) updates.handle = cleanHandle;
    }
    if (bio !== undefined) updates.bio = bio;
    if (city !== undefined) updates.city = city;
    if (now !== undefined) updates.nowReading = now;
    if (isPrivate !== undefined) updates.isPrivate = isPrivate;
    
    if (genresStr !== undefined) {
      updates.genres = genresStr.split(',').map(g => g.trim()).filter(g => g !== '');
    }

   // ... dentro da função saveProfileEdits
const avImgEl = document.getElementById('ep-av-img');
const covImgEl = document.getElementById('ep-cover-img');

    if (avImgEl && avImgEl.getAttribute('data-updated') === 'true') {
      const processedAv = await processImageForDB(avImgEl, true); 
      if (processedAv) updates.avatarUrl = processedAv;
      avImgEl.removeAttribute('data-updated');
    }
    
    if (covImgEl && covImgEl.getAttribute('data-updated') === 'true') {
      const processedCov = await processImageForDB(covImgEl, false); 
      if (processedCov) updates.coverUrl = processedCov;
      covImgEl.removeAttribute('data-updated');
    }

    await db.collection('users').doc(APP_USER.uid).update(updates);
    
    // Propaga as edições do perfil (nome e foto) para Posts, Chats e Comentários antigos
    try {
      const postsSnap = await db.collection('posts').where('authorId', '==', APP_USER.uid).get();
      
      const batches = [];
      let currentBatch = db.batch();
      let operationCount = 0;
      
      const commitAndReset = () => {
        batches.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      };

      const newAvatar = updates.avatarUrl || APP_USER.avatarUrl;
      const newName = updates.displayName || APP_USER.displayName;
      const newHandle = updates.handle || APP_USER.handle;
      
      // 1. Atualizar Posts
      postsSnap.forEach(doc => {
        if (operationCount >= 490) commitAndReset();
        currentBatch.update(doc.ref, {
          'authorSnap.avatarUrl': newAvatar,
          'authorSnap.displayName': newName,
          'authorSnap.handle': newHandle,
          isPrivate: updates.isPrivate !== undefined ? updates.isPrivate : (APP_USER.isPrivate || false)
        });
        operationCount++;
      });
      
      // 2. Atualizar Chats
      try {
        const chatsSnap = await db.collection('chats').where('users', 'array-contains', APP_USER.uid).get();
        chatsSnap.forEach(doc => {
          if (operationCount >= 490) commitAndReset();
          currentBatch.update(doc.ref, {
            [`userAvatars.${APP_USER.uid}`]: newAvatar,
            [`userNames.${APP_USER.uid}`]: newName
          });
          operationCount++;
        });
      } catch (e) {
        console.warn("Aviso: Não foi possível atualizar chats antigos:", e);
      }

      // 3. Atualizar Comentários (Requer índice 'Collection Group' no Firestore)
      try {
        const commentsSnap = await db.collectionGroup('comments').where('authorId', '==', APP_USER.uid).get();
        commentsSnap.forEach(doc => {
          if (operationCount >= 490) commitAndReset();
          currentBatch.update(doc.ref, {
            'authorSnap.avatarUrl': newAvatar,
            'authorSnap.displayName': newName,
            'authorSnap.handle': newHandle
          });
          operationCount++;
        });
      } catch (e) {
        console.warn("Aviso: Não foi possível atualizar os comentários. É necessário criar um índice de Collection Group no Firebase para a coleção 'comments'.", e);
      }
      
      if (operationCount > 0) batches.push(currentBatch);
      
      for (const b of batches) {
        await b.commit();
      }
      console.log("Propagação de perfil concluída em", batches.length, "lotes.");
    } catch(err) {
      console.error("Erro ao propagar dados do perfil:", err);
    }
    
    Object.assign(APP_USER, updates);
    renderMyProfile();
    if (typeof refreshCurrentUserPostCards === 'function') refreshCurrentUserPostCards();
    if (typeof loadFeed === 'function') loadFeed(true);
    if (typeof loadMyPosts === 'function') loadMyPosts();
    closeSheet('sh-edit-profile');
    showToast('Perfil atualizado com sucesso! ✨');
  } catch (err) {
    console.error("Erro ao salvar perfil:", err);
    showToast('Erro ao atualizar perfil. Tente uma foto menor.');
  } finally {
    if (typeof setLoginLoading === 'function') setLoginLoading(false);
    if (saveBtn) { saveBtn.textContent = btnOriginalText; saveBtn.style.opacity = '1'; saveBtn.disabled = false; }
  }
}

/**
 * Grava em todos os posts do usuário o mesmo isPrivate do perfil.
 * As regras de segurança usam esse campo para decidir quem vê cada post,
 * então ele precisa acompanhar o perfil. Também corrige posts antigos sem o campo.
 */
async function syncMyPostsPrivacy(isPrivate) {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  const wanted = !!isPrivate;
  try {
    const snap = await db.collection('posts').where('authorId', '==', APP_USER.uid).get();
    const stale = snap.docs.filter(d => d.data().isPrivate !== wanted);
    for (let i = 0; i < stale.length; i += 450) {
      const batch = db.batch();
      stale.slice(i, i + 450).forEach(d => batch.update(d.ref, { isPrivate: wanted }));
      await batch.commit();
    }
  } catch (err) {
    console.warn('Não foi possível sincronizar a privacidade dos posts:', err);
  }
}

async function savePrivacyUI() {
  if (!APP_USER) return;
  const btn = document.querySelector('#sh-privacy .sh-action');
  if (btn) { btn.textContent = 'Salvando...'; btn.disabled = true; }
  try {
    const isPrivate = document.getElementById('ep-private-settings').checked;
    await db.collection('users').doc(APP_USER.uid).update({ isPrivate });
    APP_USER.isPrivate = isPrivate;
    await syncMyPostsPrivacy(isPrivate);
    
    const isPrivEl = document.getElementById('ep-private');
    if (isPrivEl) isPrivEl.checked = isPrivate;
    
    closeSheet('sh-privacy');
    showToast('Privacidade atualizada! 🔒');
  } catch(err) {
    console.error(err);
    showToast('Erro ao atualizar privacidade');
  } finally {
    if (btn) { btn.textContent = 'Salvar'; btn.disabled = false; }
  }
}

async function loadMyPosts() {
  const container = document.getElementById('pt-posts');
  if (!container || !APP_USER || !FIREBASE_CONFIGURED) return;

  container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Carregando suas publicações...</p>';

  try {
    const postsSnap = await db.collection('posts')
      .where('authorId', '==', APP_USER.uid)
      .limit(30)
      .get();
      
    const postsList = [];
    postsSnap.forEach(p => postsList.push({ id: p.id, ...p.data() }));
    
    postsList.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    
    container.innerHTML = '<div class="posts-grid" style="display:flex;flex-direction:column;gap:12px;"></div>';
    const grid = container.querySelector('.posts-grid');
    
    if (postsList.length === 0) {
      container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Você ainda não publicou nada. 📸</p>';
      return;
    }

    for (const p of postsList) {
      if (p.isNotification) continue; 
      grid.insertAdjacentHTML('beforeend', buildPostCard(p.id, p));
      const btn = grid.querySelector(`.post-card[data-post-id="${p.id}"] .pill-like`);
      if (btn) checkLiked(p.id, btn);
    }
  } catch (err) {
    console.error('Erro ao carregar meus posts:', err);
    container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Erro ao carregar publicações.</p>';
  }
}

// ════════════════════════════════════════════════════════════
//  REPORT & BLOCK
// ════════════════════════════════════════════════════════════

async function sendReportDB(reason) {
  if (!APP_USER) return;

  if (!FIREBASE_CONFIGURED) {
    closeSheet('sh-report');
    showToast(`Denúncia enviada: ${reason} ✓`);
    return;
  }

  try {
    await db.collection('contentReports').add({
      reporterId: APP_USER.uid,
      targetId:   CURRENT_POST_ID || 'unknown',
      targetType: 'post',
      reason,
      status:     'PENDING',
      createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeSheet('sh-report');
    showToast(`Denúncia enviada ✓ Obrigado pelo aviso.`);
  } catch (err) {
    showToast('Erro ao enviar denúncia 😕');
    console.error(err);
  }
}

// ════════════════════════════════════════════════════════════
//  MODERAÇÃO (administradores em admins/{uid}, criados no console do Firebase)
// ════════════════════════════════════════════════════════════
let APP_IS_ADMIN = false;

async function checkAdmin() {
  APP_IS_ADMIN = false;
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  try {
    const snap = await db.collection('admins').doc(APP_USER.uid).get();
    APP_IS_ADMIN = snap.exists;
  } catch (e) { APP_IS_ADMIN = false; }
  const row = document.getElementById('settings-moderation');
  if (row) row.style.display = APP_IS_ADMIN ? '' : 'none';
}

function openModeration() {
  if (!APP_IS_ADMIN) return;
  openSheet('sh-moderation');
  loadReports();
}

async function loadReports() {
  const box = document.getElementById('moderation-list');
  if (!box) return;
  box.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Carregando...</p>';
  try {
    const snap = await db.collection('contentReports').where('status', '==', 'PENDING').limit(50).get();
    if (snap.empty) {
      box.innerHTML = '<p style="color:#B0A090;text-align:center;padding:30px;">Nenhuma denúncia pendente 🎉</p>';
      return;
    }
    const items = await Promise.all(snap.docs.map(async r => {
      const rep = r.data();
      let post = null;
      if (rep.targetType === 'post' && /^[A-Za-z0-9_-]+$/.test(rep.targetId || '')) {
        const p = await db.collection('posts').doc(rep.targetId).get().catch(() => null);
        post = p && p.exists ? p.data() : null;
      }
      return { id: r.id, rep, post };
    }));
    box.innerHTML = items.map(({ id, rep, post }) => {
      const when = rep.createdAt?.toDate ? timeAgo(rep.createdAt.toDate()) : '';
      const author = post ? escHtml(post.authorSnap?.displayName || post.authorSnap?.handle || 'Leitor') : '';
      const text = post ? escHtml((post.text || '').slice(0, 280)) : '<i>O post já foi removido.</i>';
      return `
        <div data-report="${escHtml(id)}" style="background:#fff;border:1px solid rgba(232,223,206,0.8);border-radius:12px;padding:12px;margin-bottom:10px;">
          <div style="font-size:.78rem;color:#C64747;font-weight:700;">Motivo: ${escHtml(rep.reason || '—')}</div>
          <div style="font-size:.75rem;color:#B0A090;margin-bottom:8px;">${when}</div>
          ${post ? `<div style="font-size:.8rem;color:#8A7060;margin-bottom:4px;">Post de <b>${author}</b>:</div>` : ''}
          <div style="font-size:.88rem;color:#1C1008;white-space:pre-wrap;margin-bottom:10px;">${text}</div>
          <div style="display:flex;gap:8px;">
            ${post ? `<button onclick="resolveReport('${escHtml(id)}', '${escHtml(rep.targetId)}', true)" style="background:#C64747;color:#fff;border:none;border-radius:20px;padding:6px 14px;font-weight:700;font-size:.8rem;cursor:pointer;">Remover post</button>` : ''}
            <button onclick="resolveReport('${escHtml(id)}', null, false)" style="background:#F0E8D6;color:#8A7060;border:none;border-radius:20px;padding:6px 14px;font-weight:700;font-size:.8rem;cursor:pointer;">Dispensar</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar denúncias:', err);
    box.innerHTML = '<p style="color:#C64747;text-align:center;padding:20px;">Não foi possível carregar as denúncias.</p>';
  }
}

async function resolveReport(reportId, postId, removePost) {
  if (!APP_IS_ADMIN) return;
  if (removePost && !confirm('Remover este post para todos?')) return;
  try {
    if (removePost && postId) await db.collection('posts').doc(postId).delete();
    await db.collection('contentReports').doc(reportId).update({
      status: removePost ? 'REMOVED' : 'DISMISSED',
      reviewedBy: APP_USER.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    document.querySelector(`#moderation-list [data-report="${reportId}"]`)?.remove();
    if (!document.querySelector('#moderation-list [data-report]')) loadReports();
    showToast(removePost ? 'Post removido ✓' : 'Denúncia dispensada');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível concluir 😕');
  }
}

async function blockUserDB(blockedId) {
  if (!APP_USER || blockedId === APP_USER.uid) return;

  if (!FIREBASE_CONFIGURED) {
    closeSheet('sh-block');
    showToast('Usuário bloqueado ✓');
    return;
  }

  try {
    const blockId = `${APP_USER.uid}_${blockedId}`;
    await db.collection('userBlocks').doc(blockId).set({
      blockerId: APP_USER.uid,
      blockedId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (!APP_BLOCKED.includes(blockedId)) APP_BLOCKED.push(blockedId);
    document.querySelectorAll(`[data-author-id="${blockedId}"]`).forEach(el => el.remove());
    closeSheet('sh-block');
    showToast('Usuário bloqueado ✓');
  } catch (err) {
    showToast('Erro ao bloquear 😕');
    console.error(err);
  }
}

// ════════════════════════════════════════════════════════════
//  BIBLIOTECA (UserBooks)
// ════════════════════════════════════════════════════════════

async function addToShelf(shelf, bookData) {
  if (!APP_USER) { showToast('Faça login para adicionar livros'); return; }

  if (!FIREBASE_CONFIGURED) {
    showToast(`Adicionado à ${shelf}! 📚`);
    return;
  }

  try {
    const bookId = (bookData.isbn || bookData.title.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now());
    await db.collection('userBooks').doc(APP_USER.uid)
      .collection('library').doc(bookId).set({
        ...bookData,
        userId:    APP_USER.uid,
        shelf,
        rating:    null,
        addedAt:   firebase.firestore.FieldValue.serverTimestamp(),
        finishedAt: shelf === 'READ' ? firebase.firestore.FieldValue.serverTimestamp() : null,
      });
    showToast(`Adicionado à ${shelf}! 📚`);
  } catch (err) {
    showToast('Erro ao adicionar livro 😕');
    console.error(err);
  }
}

// ════════════════════════════════════════════════════════════
//  UTILITÁRIOS (Helpers e Compressão de Imagem)
// ════════════════════════════════════════════════════════════

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function timeAgo(date) {
  if (!date) return 'agora';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)    return 'agora';
  if (s < 3600)  return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

function fmtCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

window.openImageModal = function(url) {
  const m = document.getElementById('img-modal');
  const img = document.getElementById('img-modal-src');
  if(m && img) { img.src = url; m.style.display = 'flex'; }
};

async function processImageForDB(imgEl, isAvatar = false) {
  if (!imgEl || !imgEl.src) return null;
  if (imgEl.src.startsWith('http') && !imgEl.src.startsWith('blob:')) return imgEl.src;

  return new Promise((resolve) => {
    const img = new Image();
    if (!imgEl.src.startsWith('data:')) {
      img.crossOrigin = 'Anonymous';
    }
    img.onerror = () => {
      console.error("Image processing error for:", imgEl.src.substring(0, 100));
      resolve(null);
    };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      let MAX_SIZE = isAvatar ? 400 : 800; 
      let width = img.width;
      let height = img.height;

      if (isAvatar) {
        const size = Math.min(width, height);
        canvas.width = size;
        canvas.height = size;
        const offsetX = (width - size) / 2;
        const offsetY = (height - size) / 2;
        ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);
        
        if (size > MAX_SIZE) {
           try {
               const smallCanvas = document.createElement('canvas');
               smallCanvas.width = MAX_SIZE;
               smallCanvas.height = MAX_SIZE;
               smallCanvas.getContext('2d').drawImage(canvas, 0, 0, MAX_SIZE, MAX_SIZE);
               resolve(smallCanvas.toDataURL('image/jpeg', 0.6));
           } catch (e) {
               console.error("toDataURL error (smallCanvas):", e);
               resolve(null);
           }
           return;
        }
        try {
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        } catch (e) {
            console.error("toDataURL error:", e);
            resolve(null);
        }
        return;
      }

      if (width > height) {
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
      } else {
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      try {
          resolve(canvas.toDataURL('image/jpeg', 0.6));
      } catch (e) {
          console.error("toDataURL error (cover):", e);
          resolve(null);
      }
    };
    img.src = imgEl.src;
  });
}

// ════════════════════════════════════════════════════════════
//  RENDER HELPERS (HTML builders)
// ════════════════════════════════════════════════════════════

function refreshCurrentUserPostCards() {
  if (!APP_USER || !APP_USER.uid) return;
  const cards = document.querySelectorAll(`.post-card[data-author-id="${APP_USER.uid}"]`);
  cards.forEach(card => {
    const img = card.querySelector('.pc-avatar');
    const nameBtn = card.querySelector('.pc-name');
    if (img && APP_USER.avatarUrl) img.src = APP_USER.avatarUrl;
    if (nameBtn && APP_USER.displayName) nameBtn.textContent = APP_USER.displayName;
  });
}

function buildPostCard(postId, d) {
  const authorId = escHtml(d.authorId || '');
  let av = escHtml(d.authorSnap?.avatarUrl || 'avatar-placeholder.svg');
  let name = escHtml(d.authorSnap?.displayName || 'Leitor');
  let handle = escHtml(d.authorSnap?.handle || 'leitor');
  
  if (APP_USER && authorId === APP_USER.uid) {
    if (APP_USER.avatarUrl) av = escHtml(APP_USER.avatarUrl);
    if (APP_USER.displayName) name = escHtml(APP_USER.displayName);
    if (APP_USER.handle) handle = escHtml(APP_USER.handle);
  }

  const time = timeAgo(d.createdAt?.toDate ? d.createdAt.toDate() : new Date());
  const text = escHtml(d.text || '');
  const img  = d.imageUrls?.[0] || d.bookSnap?.coverUrl || '';

  return `
  <article class="post-card" data-post-id="${postId}" data-author-id="${authorId}" aria-label="Post de ${name}">
    <div class="pc-header">
      <button class="pc-avatar-btn" onclick="openUserProfile('${authorId}')" aria-label="Ver perfil de ${name}">
        <img src="${av}" alt="${name}" class="pc-avatar" onerror="this.src='avatar-placeholder.svg'"/>
      </button>
      <div class="pc-meta">
        <button class="pc-name" onclick="openUserProfile('${authorId}')">${name}</button>
        <span class="pc-time">${time}</span>
      </div>
      <button class="pc-dots" onclick="openPostMenuFor('${postId}','${authorId}')" aria-label="Mais opções">
        <svg width="20" height="4" viewBox="0 0 20 4" fill="currentColor"><circle cx="2" cy="2" r="2"/><circle cx="10" cy="2" r="2"/><circle cx="18" cy="2" r="2"/></svg>
      </button>
    </div>
    ${img ? `
    <div class="pc-cover-wrap">
      <img src="${escHtml(img)}" alt="Capa do livro" class="pc-cover-img" onerror="this.parentNode.remove()"/>
    </div>` : ''}
    <div class="pc-text-wrap">
      <p class="pc-text" id="pctxt-${postId}" data-full="${text}">${text.slice(0, 200)}${text.length > 200 ? '...' : ''}</p>
      ${text.length > 200 ? `<button class="pc-see-more" data-target="pctxt-${postId}" onclick="toggleSeeMore(this)">Ver mais...</button>` : ''}
    </div>
    <div class="pc-actions">
      <button class="pill pill-like" data-liked="false" data-post-id="${postId}"
        onclick="tapLike(this,'${postId}')" aria-label="Curtir" aria-pressed="false">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" class="like-icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
        </svg>
        <span class="like-label">Like</span>
      </button>
      <button class="pill pill-icon" onclick="openCommentsFor('${postId}')" aria-label="Comentar">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
      </button>
      <button class="pill pill-icon" onclick="showToast('Link copiado! 🔗')" aria-label="Compartilhar">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
      </button>
    </div>
  </article>`;
}

function buildCommentHtml(name, avatar, text, time) {
  return `
  <div class="cmt-item">
    <img src="${escHtml(avatar)}" alt="" class="cmt-av" onerror="this.src='avatar-placeholder.svg'"/>
    <div class="cmt-body">
      <span class="cmt-name">${escHtml(name)}</span>
      <p class="cmt-text">${escHtml(text)}</p>
      <div class="cmt-actions"><span>${time}</span></div>
    </div>
  </div>`;
}

function renderFeedSkeleton(container) {
  container.innerHTML = `
  <div class="skeleton-wrap" style="display:flex;flex-direction:column;gap:12px;">
    ${[0,1,2].map(() => `
    <div class="post-card" style="animation:none;">
      <div class="pc-header" style="padding:12px 12px 8px">
        <div style="width:40px;height:40px;border-radius:50%;background:#E8DFCE;flex-shrink:0;animation:shimmer 1.5s ease-in-out infinite;"></div>
        <div style="flex:1;margin-left:10px">
          <div style="height:12px;border-radius:6px;background:#E8DFCE;margin-bottom:6px;width:40%;animation:shimmer 1.5s ease-in-out infinite;"></div>
          <div style="height:10px;border-radius:5px;background:#F0E8D6;width:25%;animation:shimmer 1.5s ease-in-out infinite 0.1s;"></div>
        </div>
      </div>
      <div style="margin:0 24px;aspect-ratio:3/4;background:#E8DFCE;border-radius:10px;animation:shimmer 1.5s ease-in-out infinite 0.2s;"></div>
      <div style="padding:12px">
        <div style="height:11px;border-radius:5px;background:#E8DFCE;margin-bottom:8px;width:90%;animation:shimmer 1.5s ease-in-out infinite 0.3s;"></div>
        <div style="height:11px;border-radius:5px;background:#E8DFCE;margin-bottom:8px;width:75%;animation:shimmer 1.5s ease-in-out infinite 0.4s;"></div>
        <div style="height:11px;border-radius:5px;background:#E8DFCE;width:55%;animation:shimmer 1.5s ease-in-out infinite 0.5s;"></div>
      </div>
    </div>`).join('')}
  </div>`;

  if (!document.getElementById('_shimmerKf')) {
    const s = document.createElement('style');
    s.id = '_shimmerKf';
    s.textContent = `@keyframes shimmer { 0%,100%{opacity:.6} 50%{opacity:1} }`;
    document.head.appendChild(s);
  }
}

function renderDemoFeed() {
  const container = document.getElementById('view-feed');
  if (container) container.querySelector('.skeleton-wrap')?.remove();
}

function emptyFeedHtml() {
  return `
  <div style="text-align:center;padding:60px 24px;color:#8A7060;">
    <div style="font-size:3rem;margin-bottom:12px">📚</div>
    <h3 style="font-family:'Lora',serif;color:#2C2016;margin-bottom:8px">Seu feed está vazio</h3>
    <p style="font-size:.88rem;line-height:1.6;margin-bottom:20px">Siga outros leitores para ver as publicações deles aqui!</p>
    <button onclick="goTo('search')" style="background:var(--terracotta);color:#fff;padding:10px 24px;border-radius:999px;font-weight:700;font-size:.88rem;">Descobrir Leitores</button>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ════════════════════════════════════════════════════════════

async function createNotification(targetUserId, type, message, postId = null) {
  if (!FIREBASE_CONFIGURED || !APP_USER || targetUserId === APP_USER.uid) {
    console.log("⚠️ Notificação cancelada: O usuário curtiu o próprio post.");
    return;
  }

  try {
    const notifRef = db.collection('users')
                       .doc(targetUserId)
                       .collection('notifications')
                       .doc(); 

    await notifRef.set({
      type: type,
      message: message,
      senderId: APP_USER.uid,
      senderAvatar: APP_USER.avatarUrl || 'avatar-placeholder.svg',
      postId: postId,
      createdAtMillis: Date.now(), 
      read: false
    });
  } catch (err) {
    console.error('Erro ao enviar notificacao:', err);
  }
}

// A mensagem da notificação é escrita por quem envia. Escapa tudo e só devolve o negrito.
function safeNotifMessage(msg) {
  return escHtml(msg).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
}

// ════════════════════════════════════════════════════════════
//  PEDIDOS PARA SEGUIR (perfis privados)
// ════════════════════════════════════════════════════════════

async function loadFollowRequests() {
  const box = document.getElementById('follow-requests');
  if (!box || !APP_USER || !FIREBASE_CONFIGURED) return;
  try {
    const snap = await db.collection('followGraph')
      .where('followedId', '==', APP_USER.uid)
      .where('status', '==', 'PENDING')
      .get();
    if (snap.empty) { box.innerHTML = ''; return; }

    const rows = await Promise.all(snap.docs.map(async d => {
      const followerId = d.data().followerId;
      const u = (await db.collection('users').doc(followerId).get()).data() || {};
      return { followerId, name: u.displayName || 'Leitor', handle: u.handle || '', avatar: u.avatarUrl || 'avatar-placeholder.svg' };
    }));

    box.innerHTML = `<div style="font-size:.78rem;font-weight:600;color:#8A7060;text-transform:uppercase;letter-spacing:.05em;margin:4px 0 8px;">Pedidos para seguir (${rows.length})</div>` +
      rows.map(r => `
        <div data-request="${escHtml(r.followerId)}" style="display:flex;align-items:center;gap:10px;background:#fff;padding:10px 12px;border-radius:12px;border:1px solid rgba(232,223,206,0.7);margin-bottom:8px;">
          <img src="${escHtml(r.avatar)}" onerror="this.src='avatar-placeholder.svg'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"/>
          <div style="flex:1;min-width:0;cursor:pointer;" onclick="openUserProfile('${escHtml(r.followerId)}')">
            <div style="font-weight:700;color:#1C1008;font-size:.9rem;">${escHtml(r.name)}</div>
            <div style="color:#B0A090;font-size:.78rem;">@${escHtml(r.handle)}</div>
          </div>
          <button onclick="answerFollowRequest('${escHtml(r.followerId)}', true)" style="background:#C8714A;color:#fff;border:none;border-radius:20px;padding:6px 14px;font-weight:700;font-size:.8rem;cursor:pointer;">Aceitar</button>
          <button onclick="answerFollowRequest('${escHtml(r.followerId)}', false)" style="background:#F0E8D6;color:#8A7060;border:none;border-radius:20px;padding:6px 12px;font-weight:700;font-size:.8rem;cursor:pointer;">Recusar</button>
        </div>`).join('');
  } catch (err) {
    console.error('Erro ao carregar pedidos para seguir:', err);
  }
}

async function answerFollowRequest(followerId, accept) {
  if (!APP_USER || !/^[A-Za-z0-9_-]+$/.test(followerId)) return;
  const ref = db.collection('followGraph').doc(`${followerId}_${APP_USER.uid}`);
  try {
    if (accept) {
      await ref.update({ status: 'ACCEPTED', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      try { await db.collection('users').doc(APP_USER.uid).update({ followersCount: firebase.firestore.FieldValue.increment(1) }); } catch (e) {}
      createNotification(followerId, 'follow_accepted', `✅ <b>${APP_USER.displayName}</b> aceitou seu pedido para seguir.`);
      showToast('Pedido aceito ✓');
    } else {
      await ref.delete();
      showToast('Pedido recusado');
    }
    document.querySelector(`#follow-requests [data-request="${followerId}"]`)?.remove();
    if (!document.querySelector('#follow-requests [data-request]')) document.getElementById('follow-requests').innerHTML = '';
  } catch (err) {
    console.error(err);
    showToast('Não foi possível responder ao pedido 😕');
  }
}

function loadNotifications() {
  const container = document.getElementById('notif-list');
  if (!container || !APP_USER || !FIREBASE_CONFIGURED) return;
  loadFollowRequests();
  
  if (DB_LISTENERS.notifs) {
    if (DB_LISTENERS.notifs_user === APP_USER.uid) {
      return; 
    } else {
      DB_LISTENERS.notifs(); 
    }
  }
  DB_LISTENERS.notifs_user = APP_USER.uid; 

  container.innerHTML = '<p style="color:#B0A090;font-size:.85rem;text-align:center;padding:20px;">Carregando...</p>';

  DB_LISTENERS.notifs = db.collection('users')
    .doc(APP_USER.uid)
    .collection('notifications')
    .orderBy('createdAtMillis', 'desc')
    .limit(30)
    .onSnapshot(snap => {
      container.innerHTML = '';
      if (snap.empty) {
        container.innerHTML = '<p style="color:#B0A090;font-size:.85rem;text-align:center;padding:40px;">Nenhuma notificação ainda. ☕</p>';
        return;
      }
      
      snap.docs.forEach(doc => {
        const d = doc.data();
        const timeStr = timeAgo(new Date(d.createdAtMillis || Date.now()));
        const safeId = v => /^[A-Za-z0-9_-]+$/.test(String(v || '')) ? v : '';
        const action = safeId(d.postId) ? `openSinglePost('${d.postId}')` : (safeId(d.senderId) ? `openUserProfile('${d.senderId}')` : '');
        const avatar = escHtml(d.senderAvatar || 'avatar-placeholder.svg');
        
        const html = `
          <div onclick="${action}" style="cursor:pointer;display:flex;align-items:center;padding:14px 0;border-bottom:1px solid rgba(232,223,206,0.5);${d.read ? 'opacity:0.7;' : ''} transition:background 0.2s;" onmouseover="this.style.background='#F0E8D6'" onmouseout="this.style.background='transparent'">
            <img src="${avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;margin-right:12px;" onerror="this.src='avatar-placeholder.svg'"/>
            <div style="flex:1;">
              <p style="font-size:.9rem;color:#1C1008;margin:0;">${safeNotifMessage(d.message)}</p>
              <p style="font-size:.75rem;color:#B0A090;margin:4px 0 0;">${timeStr}</p>
            </div>
            ${!d.read ? `<div style="width:8px;height:8px;background-color:#C8714A;border-radius:50%;margin-left:10px;"></div>` : ''}
          </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
      });
    });
}

// ════════════════════════════════════════════════════════════
//  SEARCH USERS
// ════════════════════════════════════════════════════════════

let searchTimeout = null;

async function performSearch() {
  const query = document.getElementById('search-input')?.value.trim().toLowerCase();
  const defaultView = document.getElementById('search-default-view');
  const resultsView = document.getElementById('search-results-view');

  if (!query) {
    if (defaultView) defaultView.style.display = 'block';
    if (resultsView) resultsView.style.display = 'none';
    return;
  }

  if (defaultView) defaultView.style.display = 'none';
  if (resultsView) {
    resultsView.style.display = 'flex';
    resultsView.innerHTML = '<p style="text-align:center;color:#B0A090;padding:20px;">Buscando...</p>';
  }

  if (!FIREBASE_CONFIGURED) return;

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const snap = await db.collection('users').get();
      const results = [];
      snap.forEach(doc => {
        const d = doc.data();
        const handle = (d.handle || '').toLowerCase();
        const name = (d.displayName || '').toLowerCase();
        if (handle.includes(query) || name.includes(query)) {
          results.push({ id: doc.id, ...d });
        }
      });

      if (results.length === 0) {
        resultsView.innerHTML = '<p style="text-align:center;color:#B0A090;padding:20px;">Nenhum usuário encontrado 😕</p>';
        return;
      }

      resultsView.innerHTML = '<div style="font-size:.78rem;font-weight:600;color:#8A7060;text-transform:uppercase;letter-spacing:.05em;margin-bottom:-4px;">Leitores encontrados</div>';
      for (const u of results) {
        let isFollowing = false;
        if (APP_USER) {
          const followId = `${APP_USER.uid}_${u.id}`;
          const followSnap = await db.collection('followGraph').doc(followId).get();
          if (followSnap.exists && followSnap.data().status === 'ACCEPTED') {
            isFollowing = true;
          }
        }
        
        let btnHtml = '';
        if (u.id !== APP_USER?.uid) {
          if (isFollowing) {
            btnHtml = `<button data-following="true" onclick="toggleFollow(this, '${u.id}')" style="background:#F0E8D6;color:#8A7060;border:1.5px solid transparent;border-radius:20px;padding:5px 14px;font-weight:700;font-size:.8rem;cursor:pointer;transition:all 0.2s;">Seguindo</button>`;
          } else {
            btnHtml = `<button data-following="false" onclick="toggleFollow(this, '${u.id}')" style="background:transparent;color:#C8714A;border:1.5px solid #C8714A;border-radius:20px;padding:5px 14px;font-weight:700;font-size:.8rem;cursor:pointer;transition:all 0.2s;">Seguir</button>`;
          }
        }
      
        const html = `
          <div style="display:flex;align-items:center;background:#fff;padding:12px;border-radius:12px;border:1px solid rgba(232,223,206,0.5);">
            <img src="${escHtml(u.avatarUrl || 'avatar-placeholder.svg')}" onclick="openUserProfile('${u.id}')" alt="" onerror="this.src='avatar-placeholder.svg'" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-right:12px;cursor:pointer;"/>
            <div style="flex:1;cursor:pointer;" onclick="openUserProfile('${u.id}')">
              <p style="margin:0;font-weight:700;color:#1C1008;font-size:.95rem;">${escHtml(u.displayName || 'Leitor')}</p>
              <p style="margin:0;font-size:.85rem;color:#8A7060;">@${escHtml(u.handle || 'leitor')}</p>
            </div>
            ${btnHtml}
          </div>
        `;
        resultsView.insertAdjacentHTML('beforeend', html);
      }
    } catch (err) {
      console.error('Search error:', err);
      resultsView.innerHTML = '<p style="text-align:center;color:#B0A090;padding:20px;">Erro na busca</p>';
    }
  }, 300); 
}

// ════════════════════════════════════════════════════════════
//  USER PROFILE VIEW
// ════════════════════════════════════════════════════════════

async function openUserProfile(userId) {
  if (!userId || !FIREBASE_CONFIGURED) return;
  if (APP_USER && userId === APP_USER.uid) {
    closeSheet('sh-user-profile');
    if (typeof goTo === 'function') goTo('profile');
    return;
  }
  
  openSheet('sh-user-profile');
  
  document.getElementById('up-feed-container').innerHTML = '<p style="color:#B0A090;text-align:center;">Carregando...</p>';
  document.getElementById('up-btn-row').innerHTML = '';
  
  try {
    const docSnap = await db.collection('users').doc(userId).get();
    if (!docSnap.exists) {
      document.getElementById('up-name').textContent = 'Usuário não encontrado';
      return;
    }
    
    const u = docSnap.data();
    document.getElementById('up-name').textContent = u.displayName || 'Leitor';
    document.getElementById('up-handle').textContent = '@' + (u.handle || 'leitor');
    document.getElementById('up-bio').textContent = u.bio || '';
    
    document.getElementById('up-posts-count').textContent = u.postsCount || 0;
    
    const followersSnap = await db.collection('followGraph').where('followedId', '==', userId).get();
    const dynamicFollowersCount = followersSnap.docs.filter(d => d.data().status === 'ACCEPTED').length;
    
    const followingSnap = await db.collection('followGraph').where('followerId', '==', userId).get();
    const dynamicFollowingCount = followingSnap.docs.filter(d => d.data().status === 'ACCEPTED').length;

    document.getElementById('up-followers-count').textContent = dynamicFollowersCount;
    document.getElementById('up-following-count').textContent = dynamicFollowingCount;
    
    const av = document.getElementById('up-av-img');
    if (av) { av.src = u.avatarUrl || 'avatar-placeholder.svg'; av.onerror = () => { av.src = 'avatar-placeholder.svg'; }; }
    
    const cov = document.getElementById('up-cover-img');
    if (u.coverUrl) {
      cov.src = u.coverUrl;
      cov.style.display = 'block';
    } else {
      cov.style.display = 'none';
      cov.src = '';
    }
    
    let isFollowing = false;
    let followStatus = 'NONE';
    if (APP_USER) {
      const followId = `${APP_USER.uid}_${userId}`;
      const followSnap = await db.collection('followGraph').doc(followId).get();
      if (followSnap.exists) {
         followStatus = followSnap.data().status;
         isFollowing = followStatus === 'ACCEPTED';
      }
      
      let btnHtml = '';
      if (isFollowing) {
        btnHtml = `<button data-following="true" onclick="toggleFollow(this, '${userId}')" style="background:#F0E8D6;color:#8A7060;border:1.5px solid transparent;border-radius:20px;padding:6px 20px;font-weight:700;font-size:.9rem;cursor:pointer;transition:all 0.2s;">Seguindo</button>`;
      } else if (followStatus === 'PENDING') {
        btnHtml = `<button data-following="false" onclick="toggleFollow(this, '${userId}')" style="background:#F0E8D6;color:#8A7060;border:1.5px solid transparent;border-radius:20px;padding:6px 20px;font-weight:700;font-size:.9rem;cursor:pointer;transition:all 0.2s;">Solicitado</button>`;
      } else {
        btnHtml = `<button data-following="false" onclick="toggleFollow(this, '${userId}')" style="background:transparent;color:#C8714A;border:1.5px solid #C8714A;border-radius:20px;padding:6px 20px;font-weight:700;font-size:.9rem;cursor:pointer;transition:all 0.2s;">Seguir</button>`;
      }
      const safeName = (u.displayName || 'Leitor').replace(/'/g, "\\'");
      const safeAv = (u.avatarUrl || 'avatar-placeholder.svg').replace(/'/g, "\\'");
      btnHtml += ` <button onclick="closeSheet('sh-user-profile'); startChat('${userId}', '${safeName}', '${safeAv}')" style="background:#F4EFEB;color:#C8714A;border:1.5px solid transparent;border-radius:20px;padding:6px 20px;font-weight:700;font-size:.9rem;cursor:pointer;transition:all 0.2s;margin-left:8px;">Mensagem</button>`;
      document.getElementById('up-btn-row').innerHTML = btnHtml;
    }
    
    if (u.isPrivate && (!APP_USER || (APP_USER.uid !== userId && !isFollowing))) {
       document.getElementById('up-feed-container').innerHTML = '<div style="text-align:center;padding:40px 20px;"><span style="font-size:2.5rem;display:block;margin-bottom:10px;">🔒</span><h3 style="color:#2C2016;font-family:\'Lora\',serif;">Esta conta é privada</h3><p style="color:#B0A090;font-size:0.9rem;">Siga para ver as publicações desta pessoa.</p></div>';
       return;
    }
    
    let postsQuery = db.collection('posts').where('authorId', '==', userId);
    // Quem não segue (ou não é o dono) só pode buscar os posts públicos.
    if (!APP_USER || (APP_USER.uid !== userId && !isFollowing)) {
      postsQuery = postsQuery.where('isPrivate', '==', false);
    }
    const postsSnap = await postsQuery.limit(20).get();
    const postsList = [];
    postsSnap.forEach(p => postsList.push({ id: p.id, ...p.data() }));
    postsList.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    
    const feedContainer = document.getElementById('up-feed-container');
    feedContainer.innerHTML = '';
    if (postsList.length === 0) {
      feedContainer.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Nenhuma publicação ainda.</p>';
    } else {
      for (const p of postsList) {
        if (p.isNotification) continue;
        feedContainer.insertAdjacentHTML('beforeend', buildPostCard(p.id, p));
        const btn = feedContainer.querySelector(`.post-card[data-post-id="${p.id}"] .pill-like`);
        if (btn) checkLiked(p.id, btn);
      }
    }

  } catch (err) {
    console.error('Error fetching user profile:', err);
    document.getElementById('up-name').textContent = 'Erro ao carregar';
  }
}

// ════════════════════════════════════════════════════════════
//  SINGLE POST VIEW
// ════════════════════════════════════════════════════════════

async function openSinglePost(postId) {
  if (!postId || !FIREBASE_CONFIGURED) return;
  
  openSheet('sh-single-post');
  const container = document.getElementById('sp-container');
  container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Carregando publicação...</p>';
  
  try {
    const docSnap = await db.collection('posts').doc(postId).get();
    if (!docSnap.exists) {
      container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Publicação não encontrada ou foi excluída.</p>';
      return;
    }
    
    container.innerHTML = '';
    const p = docSnap.data();
    container.insertAdjacentHTML('beforeend', buildPostCard(docSnap.id, p));
    const btn = container.querySelector(`.post-card[data-post-id="${docSnap.id}"] .pill-like`);
    if (btn) checkLiked(docSnap.id, btn);
    
  } catch (err) {
    console.error('Erro ao carregar post:', err);
    container.innerHTML = '<p style="color:#B0A090;text-align:center;padding:20px;">Erro ao carregar.</p>';
  }
}

// ════════════════════════════════════════════════════════════
//  BOOK SHELVES (LIBRARY)
// ════════════════════════════════════════════════════════════

let MY_LIBRARY = {}; // Cache of the user's books by ID

// Escuta a subcoleção 'library' do usuário logado
function listenMyLibrary() {
  if (!APP_USER || !db) return;
  
  db.collection('users').doc(APP_USER.uid).collection('library').onSnapshot(snap => {
    MY_LIBRARY = {};
    const tbr = [], read = [], wish = [];
    
    snap.forEach(doc => {
      const book = { id: doc.id, ...doc.data() };
      MY_LIBRARY[doc.id] = book;
      if (book.status === 'tbr') tbr.push(book);
      else if (book.status === 'read') read.push(book);
      else if (book.status === 'wishlist') wish.push(book);
    });
    
    renderShelf('list-tbr', tbr);
    renderShelf('list-read', read);
    renderShelf('list-wishlist', wish);
    
    updateReadingChallenge(read.length);
  });
}

function renderShelf(containerId, books) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (books.length === 0) {
    container.innerHTML = '<p style="color:#B0A090; font-size:0.9rem; text-align:center; margin-top:20px;">Nenhum livro nesta estante.</p>';
    return;
  }
  
  container.innerHTML = books.map(book => {
    const escData = escHtml(JSON.stringify(book));
    let ratingHtml = '';
    if (book.status === 'read' && book.rating) {
      ratingHtml = `<div class="shelf-book-rating">★ ${book.rating}</div>`;
    }
    
    return `
      <div class="shelf-book" onclick="openBookOptions('${book.id}')">
        <div class="shelf-book-cover-wrap">
          <img src="${book.coverUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}" class="shelf-book-cover" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';"/>
          ${ratingHtml}
        </div>
        <h4 class="shelf-book-title">${escHtml(book.title)}</h4>
        <p class="shelf-book-author">${escHtml(book.author)}</p>
      </div>
    `;
  }).join('');
}

function updateReadingChallenge(readCount) {
  if (!APP_USER) return;
  const goal = APP_USER.readingGoal || 24;
  
  if (APP_USER.booksRead !== readCount) {
    APP_USER.booksRead = readCount;
    db.collection('users').doc(APP_USER.uid).update({ booksRead: readCount });
  }
  
  const textEl = document.getElementById('my-chal-count');
  const fillEl = document.getElementById('chal-fill');
  if (textEl) textEl.textContent = `${readCount}/${goal} livros`;
  
  if (fillEl) {
    let pct = Math.min((readCount / goal) * 100, 100);
    fillEl.style.width = pct + '%';
  }
}

async function saveBookToLibrary(bookData, shelf) {
  if (!APP_USER) return;
  try {
    const bookRef = db.collection('users').doc(APP_USER.uid).collection('library').doc(bookData.id);
    await bookRef.set({
      title: bookData.title,
      author: bookData.author,
      coverUrl: bookData.coverUrl,
      status: shelf,
      rating: bookData.rating || 0,
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Estante atualizada! 📚');
  } catch (err) {
    console.error("Erro ao salvar livro:", err);
    showToast('Erro ao salvar livro.');
  }
}

async function removeBookFromLibrary(bookId) {
  if (!APP_USER) return;
  try {
    await db.collection('users').doc(APP_USER.uid).collection('library').doc(bookId).delete();
    showToast('Livro removido da estante.');
  } catch (err) {
    console.error("Erro ao remover livro:", err);
    showToast('Erro ao remover livro.');
  }
}
// ════════════════════════════════════════════════
// CHAT SYSTEM
// ════════════════════════════════════════════════
let CURRENT_CHAT_ID = null;
let CURRENT_CHAT_USERS = [];
let CURRENT_CHAT_UNSUB = null;
let CHATS_LIST_UNSUB = null;

async function startChat(otherUserId, otherUserName, otherUserAvatar) {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  const myId = APP_USER.uid;
  const chatId = myId < otherUserId ? myId + '_' + otherUserId : otherUserId + '_' + myId;
  
  const chatRef = db.collection('chats').doc(chatId);
  const snap = await chatRef.get();
  
  const users = [myId, otherUserId];

  if (!snap.exists) {
    try {
    await chatRef.set({
      users: users,
      lastMessage: '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      userNames: {
        [myId]: APP_USER.displayName || APP_USER.handle,
        [otherUserId]: otherUserName
      },
      userAvatars: {
        [myId]: APP_USER.avatarUrl || 'avatar-placeholder.svg',
        [otherUserId]: otherUserAvatar || 'avatar-placeholder.svg'
      }
    });
    } catch (err) {
      console.warn('Conversa não permitida:', err);
      showToast('Para conversar, uma de vocês precisa seguir a outra 💬');
      return;
    }
  }
  
  openChatRoom(chatId, otherUserName, otherUserAvatar, users);
}

function loadChats() {
  if (!APP_USER || !FIREBASE_CONFIGURED) return;
  const container = document.getElementById('chats-list-container');
  if (!container) return;
  container.innerHTML = '<p style="text-align:center;color:#B0A090;">Carregando mensagens...</p>';
  
  if (CHATS_LIST_UNSUB) CHATS_LIST_UNSUB();
  
  CHATS_LIST_UNSUB = db.collection('chats')
    .where('users', 'array-contains', APP_USER.uid)
    .onSnapshot((snapshot) => {
      container.innerHTML = '';
      if (snapshot.empty) {
        container.innerHTML = '<p style="text-align:center;color:#B0A090;margin-top:20px;">Nenhuma conversa ainda.</p>';
        return;
      }
       
      const sortedDocs = snapshot.docs.slice().sort((a, b) => {
        const aTime = a.data().updatedAt ? a.data().updatedAt.toMillis() : 0;
        const bTime = b.data().updatedAt ? b.data().updatedAt.toMillis() : 0;
        return bTime - aTime;
      });

      sortedDocs.forEach(doc => {
        const d = doc.data();
        const otherId = Array.isArray(d.users) ? d.users.find(id => id !== APP_USER.uid) : null;
        const name = escHtml(d.userNames?.[otherId] || 'Usuário');
        const av = escHtml(d.userAvatars?.[otherId] || 'avatar-placeholder.svg');
        const lastMessage = escHtml(d.lastMessage || 'Nova conversa');
         
        container.innerHTML += `
          <div class="chat-item" onclick='openChatRoom(${JSON.stringify(doc.id)}, ${JSON.stringify(name)}, ${JSON.stringify(av)}, ${JSON.stringify(d.users)})'>
            <img src="${av}" class="chat-item-av" onerror="this.src='avatar-placeholder.svg'" />
            <div class="chat-item-info">
              <h4 class="chat-item-name">${name}</h4>
              <p class="chat-item-last">${lastMessage}</p>
            </div>
          </div>
        `;
      });
    }, err => {
      console.error('Error loading chats:', err);
      container.innerHTML = '<p style="text-align:center;color:#B0A090;margin-top:20px;">Não foi possível carregar as conversas. Atualize a página e verifique suas regras/índices do Firebase.</p>';
    });}

function openChatRoom(chatId, otherUserName, otherUserAvatar) {
  CURRENT_CHAT_ID = chatId;
  const nameEl = document.getElementById('chat-room-name');
  const avEl = document.getElementById('chat-room-av');
  if(nameEl) nameEl.textContent = otherUserName || 'Leitor';
  if(avEl) avEl.src = otherUserAvatar || 'avatar-placeholder.svg';
  
  const container = document.getElementById('chat-messages-container');
  if(container) container.innerHTML = '';
  
  const input = document.getElementById('chat-input');
  if(input) input.value = '';
  
  if (CURRENT_CHAT_UNSUB) CURRENT_CHAT_UNSUB();
  
  if (typeof goTo === 'function') goTo('chat-room');
  
  CURRENT_CHAT_UNSUB = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot((snapshot) => {
      if(!container) return;
      container.innerHTML = '';
      
      snapshot.forEach(doc => {
        const d = doc.data();
        const isMe = d.senderId === APP_USER.uid;
        const time = d.createdAt ? new Date(d.createdAt.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        
        container.innerHTML += `
          <div class="chat-bubble ${isMe ? 'me' : 'other'}">${d.text}</div>
          <div class="chat-time">${time}</div>
        `;
      });
      container.scrollTop = container.scrollHeight;
    });
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || !CURRENT_CHAT_ID) return;
  
  const text = input.value.trim();
  input.value = '';
  
  const msgRef = db.collection('chats').doc(CURRENT_CHAT_ID).collection('messages').doc();
  const batch = db.batch();
  
  batch.set(msgRef, {
    senderId: APP_USER.uid,
    text: text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  
  batch.update(db.collection('chats').doc(CURRENT_CHAT_ID), {
    lastMessage: text,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  
  await batch.commit();
}


// ════════════════════════════════════════════════
// NEW CHAT - FOLLOWER SEARCH
// ════════════════════════════════════════════════
let cachedFollowersForChat = [];
let followersLoaded = false;

async function loadFollowersForChat() {
  if (!APP_USER || !FIREBASE_CONFIGURED || followersLoaded) return;
  const container = document.getElementById('new-chat-list');
  if (!container) return;
  
  container.innerHTML = '<p style="text-align:center; color:#B0A090; padding:20px;">Carregando seguidores...</p>';
  followersLoaded = true;
  
  try {
    // Busca quem o usuário segue
    const followingSnap = await db.collection('followGraph').where('followerId', '==', APP_USER.uid).get();
    
    // Busca quem segue o usuário
    const followersSnap = await db.collection('followGraph').where('followedId', '==', APP_USER.uid).get();
    
    const userIds = new Set();
    followingSnap.forEach(d => { if (d.data().status === 'ACCEPTED') userIds.add(d.data().followedId); });
    followersSnap.forEach(d => { if (d.data().status === 'ACCEPTED') userIds.add(d.data().followerId); });
    
    if (userIds.size === 0) {
      container.innerHTML = '<p style="text-align:center; color:#B0A090; padding:20px;">Você ainda não tem conexões. Comece a seguir leitores para conversar!</p>';
      return;
    }
    
    // Fetch users info
    const users = [];
    for (const id of userIds) {
      const uSnap = await db.collection('users').doc(id).get();
      if (uSnap.exists) {
        users.push({ id: uSnap.id, ...uSnap.data() });
      }
    }
    
    cachedFollowersForChat = users.sort((a,b) => (a.displayName || '').localeCompare(b.displayName || ''));
    renderChatFollowers(cachedFollowersForChat);
    
  } catch (err) {
    console.error('Erro ao carregar seguidores:', err);
    container.innerHTML = '<p style="text-align:center; color:#B0A090; padding:20px;">Erro ao carregar lista.</p>';
  }
}

function handleChatSearchFocus() {
  loadFollowersForChat();
  handleChatSearchInput();
}

function handleChatSearchInput() {
  const query = document.getElementById('new-chat-search').value.toLowerCase().trim();
  const listContainer = document.getElementById('new-chat-list');
  const chatsContainer = document.getElementById('chats-list-container');
  
  if (query) {
    if(listContainer) listContainer.style.display = 'flex';
    if(chatsContainer) chatsContainer.style.display = 'none';
    filterChatFollowers();
  } else {
    if(listContainer) listContainer.style.display = 'none';
    if(chatsContainer) chatsContainer.style.display = 'flex';
  }
}

function renderChatFollowers(list) {
  const container = document.getElementById('new-chat-list');
  if (!container) return;
  
  if (list.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#B0A090; padding:20px;">Nenhum usuário encontrado.</p>';
    return;
  }
  
  let html = '';
  for (const u of list) {
    const safeName = escHtml(u.displayName || 'Leitor');
    const safeAv = escHtml(u.avatarUrl || 'avatar-placeholder.svg');
    const safeHandle = escHtml(u.handle || 'leitor');
     
    html += `
      <div onclick="resetChatSearch(); startChat(${JSON.stringify(u.id)}, ${JSON.stringify(safeName)}, ${JSON.stringify(safeAv)})" style="display:flex; align-items:center; padding:12px; border-bottom:1px solid #E8DFCE; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#F0E8D6'" onmouseout="this.style.background='transparent'">
        <img src="${safeAv}" onerror="this.src='avatar-placeholder.svg'" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:12px;"/>
        <div>
          <p style="margin:0; font-weight:600; color:#1C1008; font-size:0.95rem;">${safeName}</p>
          <p style="margin:0; font-size:0.8rem; color:#8A7060;">@${safeHandle}</p>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function filterChatFollowers() {
  const query = document.getElementById('new-chat-search').value.toLowerCase().trim();
  if (!query) {
    renderChatFollowers(cachedFollowersForChat);
    return;
  }
  
  const filtered = cachedFollowersForChat.filter(u => {
    return (u.displayName || '').toLowerCase().includes(query) || (u.handle || '').toLowerCase().includes(query);
  });
  
  renderChatFollowers(filtered);
}

function resetChatSearch() {
  const input = document.getElementById('new-chat-search');
  if (input) input.value = '';
  const listContainer = document.getElementById('new-chat-list');
  const chatsContainer = document.getElementById('chats-list-container');
  if(listContainer) listContainer.style.display = 'none';
  if(chatsContainer) chatsContainer.style.display = 'flex';
}
