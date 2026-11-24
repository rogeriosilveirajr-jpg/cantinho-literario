// Testes das regras do Firestore. Rodam no emulador local (não tocam no banco real):
//   npm install && npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp, writeBatch, increment } from 'firebase/firestore';

let env;
const ANA = 'ana', BIA = 'bia', CAIO = 'caio', MOD = 'moderadora';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cantinho',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  // Dados iniciais gravados sem regras: Ana tem perfil privado, Bia é pública.
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ANA), { displayName: 'Ana', isPrivate: true });
    await setDoc(doc(db, 'users', BIA), { displayName: 'Bia', isPrivate: false });
    await setDoc(doc(db, 'users', CAIO), { displayName: 'Caio', isPrivate: false });
    await setDoc(doc(db, 'users', MOD), { displayName: 'Mod', isPrivate: false });
    await setDoc(doc(db, 'admins', MOD), { since: 1 });
    await setDoc(doc(db, 'posts', 'post-ana'), { authorId: ANA, isPrivate: true, text: 'privado', createdAt: 1 });
    await setDoc(doc(db, 'posts', 'post-bia'), { authorId: BIA, isPrivate: false, text: 'público', createdAt: 2 });
    await setDoc(doc(db, 'users', ANA, 'library', 'livro1'), { title: 'Dom Casmurro' });
    await setDoc(doc(db, 'contentReports', 'r1'), { reporterId: BIA, targetId: 'post-ana', status: 'PENDING' });
  });
});

const as = uid => env.authenticatedContext(uid).firestore();

// ---------- 1. privacidade ----------
test('quem não segue não lê post nem estante de perfil privado', async () => {
  await assertFails(getDoc(doc(as(BIA), 'posts', 'post-ana')));
  await assertFails(getDocs(collection(as(BIA), 'users', ANA, 'library')));
});

test('o feed de posts públicos funciona para todos', async () => {
  const q = query(collection(as(BIA), 'posts'), where('isPrivate', '==', false), orderBy('createdAt', 'desc'));
  await assertSucceeds(getDocs(q));
});

test('busca geral sem o filtro de privacidade é recusada', async () => {
  await assertFails(getDocs(query(collection(as(BIA), 'posts'), orderBy('createdAt', 'desc'))));
});

test('buscar os posts de um perfil privado que não sigo é recusado; seguidor e dona conseguem', async () => {
  await assertFails(getDocs(query(collection(as(BIA), 'posts'), where('authorId', '==', ANA))));
  await assertSucceeds(getDocs(query(collection(as(ANA), 'posts'), where('authorId', '==', ANA))));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'followGraph', `${CAIO}_${ANA}`), { followerId: CAIO, followedId: ANA, status: 'ACCEPTED' });
  });
  await assertSucceeds(getDocs(query(collection(as(CAIO), 'posts'), where('authorId', '==', ANA))));
});

test('seguidor aceito lê o post privado', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'followGraph', `${BIA}_${ANA}`), { followerId: BIA, followedId: ANA, status: 'ACCEPTED' });
  });
  await assertSucceeds(getDoc(doc(as(BIA), 'posts', 'post-ana')));
});

// ---------- 2. pedidos para seguir ----------
test('não dá para se autoaprovar num perfil privado', async () => {
  await assertFails(setDoc(doc(as(BIA), 'followGraph', `${BIA}_${ANA}`), { followerId: BIA, followedId: ANA, status: 'ACCEPTED' }));
  await assertSucceeds(setDoc(doc(as(BIA), 'followGraph', `${BIA}_${ANA}`), { followerId: BIA, followedId: ANA, status: 'PENDING' }));
  await assertFails(updateDoc(doc(as(BIA), 'followGraph', `${BIA}_${ANA}`), { status: 'ACCEPTED' }));
});

test('só a dona do perfil aceita o pedido', async () => {
  await assertSucceeds(setDoc(doc(as(BIA), 'followGraph', `${BIA}_${ANA}`), { followerId: BIA, followedId: ANA, status: 'PENDING' }));
  await assertSucceeds(updateDoc(doc(as(ANA), 'followGraph', `${BIA}_${ANA}`), { status: 'ACCEPTED', updatedAt: serverTimestamp() }));
});

test('perfil público aceita seguir direto', async () => {
  await assertSucceeds(setDoc(doc(as(CAIO), 'followGraph', `${CAIO}_${BIA}`), { followerId: CAIO, followedId: BIA, status: 'ACCEPTED' }));
});

// ---------- 3. chat ----------
const chatOf = (a, b) => ({ users: [a, b], lastMessage: '', userNames: {}, userAvatars: {} });

test('desconhecidos não abrem conversa', async () => {
  await assertFails(setDoc(doc(as(CAIO), 'chats', `${BIA}_${CAIO}`), chatOf(BIA, CAIO)));
});

test('quem se segue conversa; depois do bloqueio, não', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'followGraph', `${CAIO}_${BIA}`), { followerId: CAIO, followedId: BIA, status: 'ACCEPTED' });
  });
  const caio = as(CAIO);
  await assertSucceeds(getDoc(doc(caio, 'chats', `${BIA}_${CAIO}`))); // conversa ainda não existe
  await assertSucceeds(setDoc(doc(caio, 'chats', `${BIA}_${CAIO}`), chatOf(BIA, CAIO)));
  await assertSucceeds(addDoc(collection(caio, 'chats', `${BIA}_${CAIO}`, 'messages'), { senderId: CAIO, text: 'Oi!', createdAt: serverTimestamp() }));

  await assertSucceeds(setDoc(doc(as(BIA), 'userBlocks', `${BIA}_${CAIO}`), { blockerId: BIA, blockedId: CAIO }));
  await assertFails(addDoc(collection(caio, 'chats', `${BIA}_${CAIO}`, 'messages'), { senderId: CAIO, text: 'Oi de novo', createdAt: serverTimestamp() }));
});

// ---------- 4. moderação ----------
test('denúncias: usuário comum não lê, moderadora lê e resolve', async () => {
  await assertFails(getDoc(doc(as(BIA), 'contentReports', 'r1')));
  await assertSucceeds(getDocs(query(collection(as(MOD), 'contentReports'), where('status', '==', 'PENDING'))));
  await assertSucceeds(getDoc(doc(as(MOD), 'posts', 'post-ana')));
  await assertSucceeds(updateDoc(doc(as(MOD), 'contentReports', 'r1'), { status: 'DISMISSED' }));
});

// ---------- 5. campos dos recursos de leitor nos posts ----------
const post = (extra = {}) => ({ authorId: BIA, isPrivate: false, text: 'oi', createdAt: serverTimestamp(), ...extra });

test('resenha com livro, nota de 1 a 5 e spoiler é aceita', async () => {
  await assertSucceeds(addDoc(collection(as(BIA), 'posts'),
    post({ postType: 'normal', bookId: 'duna', book: { id: 'duna', title: 'Duna' }, rating: 5, hasSpoiler: true })));
});

test('nota fora de 0..5, não inteira ou tipo desconhecido é recusada (valor-limite)', async () => {
  for (const bad of [{ rating: 6 }, { rating: -1 }, { rating: 4.5 }, { rating: '5' }, { postType: 'anuncio' }, { hasSpoiler: 'sim' }]) {
    await assertFails(addDoc(collection(as(BIA), 'posts'), post(bad)));
  }
});

test('texto acima de 2000 caracteres é recusado', async () => {
  await assertSucceeds(addDoc(collection(as(BIA), 'posts'), post({ text: 'a'.repeat(2000) })));
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ text: 'a'.repeat(2001) })));
});

test('troca nasce disponível e não pode nascer concluída', async () => {
  await assertSucceeds(addDoc(collection(as(BIA), 'posts'), post({ postType: 'trade', tradeStatus: 'AVAILABLE', location: 'Joinville' })));
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ postType: 'trade', tradeStatus: 'DONE' })));
});

test('status da troca: dona avança, troca concluída não volta, outra pessoa não mexe', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'posts', 'troca'), { authorId: BIA, isPrivate: false, postType: 'trade', tradeStatus: 'AVAILABLE', createdAt: 3 });
  });
  await assertFails(updateDoc(doc(as(CAIO), 'posts', 'troca'), { tradeStatus: 'DONE' }));
  await assertSucceeds(updateDoc(doc(as(BIA), 'posts', 'troca'), { tradeStatus: 'RESERVED' }));
  await assertSucceeds(updateDoc(doc(as(BIA), 'posts', 'troca'), { tradeStatus: 'DONE' }));
  await assertFails(updateDoc(doc(as(BIA), 'posts', 'troca'), { tradeStatus: 'AVAILABLE' }));
  await assertFails(updateDoc(doc(as(BIA), 'posts', 'troca'), { tradeStatus: 'VENDIDO' }));
});

test('página do livro e aba de trocas: buscas com isPrivate == false são aceitas', async () => {
  const posts = collection(as(CAIO), 'posts');
  await assertSucceeds(getDocs(query(posts, where('bookId', '==', 'duna'), where('isPrivate', '==', false), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(posts, where('isPrivate', '==', false), where('postType', '==', 'trade'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(posts, where('authorId', 'in', [BIA, CAIO]), where('isPrivate', '==', false))));
  await assertFails(getDocs(query(posts, where('bookId', '==', 'duna'))));
});

test('progresso de leitura: só a dona grava na própria estante', async () => {
  await assertSucceeds(setDoc(doc(as(BIA), 'users', BIA, 'library', 'duna'), { title: 'Duna', status: 'reading', currentPage: 10, totalPages: 600 }));
  await assertFails(setDoc(doc(as(CAIO), 'users', BIA, 'library', 'duna'), { currentPage: 600 }));
});

// ---------- 6. clubes do livro ----------
const autoId = tag => tag.padEnd(20, '0');   // formato dos ids automáticos do Firestore
const [C1, C2, C3, C4, N2, N3, N61] = ['clubeA', 'clubeB', 'clubeC', 'clubeD', 'nomeDois', 'nomeTres', 'nomeSessentaUm'].map(autoId);
async function createClubAs(uid, clubId, extra = {}) {
  const db = as(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'clubs', clubId), { name: 'Clube de Fantasia', description: '', city: 'Joinville', ownerId: uid, membersCount: 1, bookOfMonth: null, createdAt: serverTimestamp(), ...extra });
  batch.set(doc(db, 'clubs', clubId, 'members', uid), { uid, name: uid, joinedAt: serverTimestamp() });
  return batch.commit();
}

function joinAs(uid, clubId, delta = 1) {
  const db = as(uid);
  const batch = writeBatch(db);
  if (delta > 0) batch.set(doc(db, 'clubs', clubId, 'members', uid), { uid, joinedAt: serverTimestamp() });
  else batch.delete(doc(db, 'clubs', clubId, 'members', uid));
  batch.update(doc(db, 'clubs', clubId), { membersCount: increment(delta) });
  return batch.commit();
}

test('criar clube: dono entra junto; sem entrar, ou com contador errado, falha', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  await assertFails(setDoc(doc(as(CAIO), 'clubs', C2), { name: 'Sem membro', ownerId: CAIO, membersCount: 1 }));
  await assertFails(createClubAs(CAIO, C3, { membersCount: 50 }));
  await assertFails(createClubAs(CAIO, C4, { ownerId: BIA }));
});

test('nome do clube: 2 letras falha, 3 passa, 61 falha (valor-limite)', async () => {
  await assertFails(createClubAs(BIA, N2, { name: 'ab' }));
  await assertSucceeds(createClubAs(BIA, N3, { name: 'abc' }));
  await assertFails(createClubAs(BIA, N61, { name: 'x'.repeat(61) }));
});

test('entrar e sair mexem no contador de 1 em 1, sempre junto com a participação', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  await assertSucceeds(joinAs(CAIO, C1, 1));
  await assertFails(joinAs(CAIO, C1, 1));                                   // já é membro
  await assertFails(updateDoc(doc(as(ANA), 'clubs', C1), { membersCount: increment(1) }));   // contador sem entrar
  await assertFails(setDoc(doc(as(ANA), 'clubs', C1, 'members', ANA), { uid: ANA }));         // entrar sem contador
  await assertFails(setDoc(doc(as(ANA), 'clubs', C1, 'members', CAIO), { uid: CAIO }));       // inscrever outra pessoa
  await assertSucceeds(joinAs(CAIO, C1, -1));
  let count;
  await env.withSecurityRulesDisabled(async ctx => { count = (await getDoc(doc(ctx.firestore(), 'clubs', C1))).data().membersCount; });
  assert.equal(count, 1);
});

test('o dono não sai do próprio clube', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  await assertFails(joinAs(BIA, C1, -1));
});

test('só o dono muda dados e livro do mês; ninguém muda o dono', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  await assertSucceeds(updateDoc(doc(as(BIA), 'clubs', C1), { bookOfMonth: { id: 'duna', title: 'Duna' } }));
  await assertFails(updateDoc(doc(as(CAIO), 'clubs', C1), { bookOfMonth: { id: 'x', title: 'X' } }));
  await assertFails(updateDoc(doc(as(BIA), 'clubs', C1), { ownerId: CAIO }));
  await assertFails(updateDoc(doc(as(BIA), 'clubs', C1), { membersCount: 99 }));
});

test('conversa do clube: só membros leem e escrevem, com texto de 1 a 1000', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  const msgs = uid => collection(as(uid), 'clubs', C1, 'messages');
  await assertSucceeds(addDoc(msgs(BIA), { senderId: BIA, text: 'Bem-vindos!', createdAt: serverTimestamp() }));
  await assertFails(getDocs(msgs(CAIO)));
  await assertFails(addDoc(msgs(CAIO), { senderId: CAIO, text: 'oi', createdAt: serverTimestamp() }));
  await assertFails(addDoc(msgs(BIA), { senderId: CAIO, text: 'me passando por outra pessoa' }));
  await assertFails(addDoc(msgs(BIA), { senderId: BIA, text: '' }));
  await assertFails(addDoc(msgs(BIA), { senderId: BIA, text: 'x'.repeat(1001) }));
  await assertSucceeds(joinAs(CAIO, C1, 1));
  await assertSucceeds(getDocs(msgs(CAIO)));
});

test('visitante sem login não lê clubes', async () => {
  await assertSucceeds(createClubAs(BIA, C1));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'clubs', C1)));
});

// ---------- 7. ids e campos maliciosos (XSS armazenado) ----------
test('post com id escolhido à mão (fora do formato automático) é recusado', async () => {
  await assertFails(setDoc(doc(as(BIA), 'posts', "x');alert(1);x('"), post()));
  await assertFails(setDoc(doc(as(BIA), 'posts', 'idCurto'), post()));
  await assertSucceeds(setDoc(doc(as(BIA), 'posts', autoId('postValido')), post()));
});

test('bookId e livro com código ou campos extras são recusados', async () => {
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ bookId: "x');fetch('//mal');//", book: { id: 'ok', title: 'T' } })));
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ bookId: 'ok', book: { id: "a'b", title: 'T' } })));
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ bookId: 'ok', book: { id: 'ok', title: 'T', onclick: 'x' } })));
  await assertFails(addDoc(collection(as(BIA), 'posts'), post({ bookId: 'ok', book: { id: 'ok', title: 'T'.repeat(301) } })));
  await assertSucceeds(addDoc(collection(as(BIA), 'posts'), post({ bookId: 'zyTCAlFPjgYC', book: { id: 'zyTCAlFPjgYC', title: 'Duna', author: 'Frank Herbert', coverUrl: 'https://books.google.com/x.jpg' } })));
});

test('estante não aceita id de livro com código', async () => {
  await assertFails(setDoc(doc(as(BIA), 'users', BIA, 'library', "x');alert(1);x('"), { title: 'X' }));
});

test('clube com id escolhido à mão ou livro do mês inválido é recusado', async () => {
  await assertFails(createClubAs(BIA, "x');alert(1);x('"));
  await assertSucceeds(createClubAs(BIA, C1));
  await assertFails(updateDoc(doc(as(BIA), 'clubs', C1), { bookOfMonth: { id: "a');b//", title: 'X' } }));
});

test('denúncia com alvo que não é um id seguro é recusada (protege a tela do moderador)', async () => {
  await assertFails(addDoc(collection(as(BIA), 'contentReports'), { reporterId: BIA, targetId: "p');alert(1)//", status: 'PENDING' }));
  await assertSucceeds(addDoc(collection(as(BIA), 'contentReports'), { reporterId: BIA, targetId: 'post-ana', status: 'PENDING' }));
});

test('ninguém altera o próprio contador de seguidores', async () => {
  await assertFails(updateDoc(doc(as(BIA), 'users', BIA), { followersCount: 9999 }));
  await assertSucceeds(updateDoc(doc(as(BIA), 'users', BIA), { bio: 'leitora', clubIds: [] }));
  await assertFails(setDoc(doc(as('nova'), 'users', 'nova'), { displayName: 'Nova', followersCount: 500 }));
});

// ---------- 8. painel do moderador (admin.html) ----------
const ban = (by = MOD) => ({ reason: 'spam', bannedBy: by, bannedAt: serverTimestamp() });

test('painel: moderadora lista todos os posts (inclusive privados) e todos os usuários', async () => {
  await assertSucceeds(getDocs(query(collection(as(MOD), 'posts'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(collection(as(MOD), 'users'), orderBy('createdAt', 'desc'))));
});

test('bloquear usuário: só moderadora bloqueia; não bloqueia a si mesma nem outro moderador', async () => {
  await assertFails(setDoc(doc(as(BIA), 'bannedUsers', CAIO), ban(BIA)));
  await assertFails(setDoc(doc(as(MOD), 'bannedUsers', MOD), ban()));
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'admins', 'mod2'), { since: 1 }); });
  await assertFails(setDoc(doc(as(MOD), 'bannedUsers', 'mod2'), ban()));
  await assertFails(setDoc(doc(as(MOD), 'bannedUsers', CAIO), { ...ban(), extra: 1 }));
  await assertSucceeds(setDoc(doc(as(MOD), 'bannedUsers', CAIO), ban()));
});

test('lista de bloqueados: usuário comum recebe permissão negada; o bloqueado vê só o próprio aviso', async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'bannedUsers', CAIO), { reason: 'spam' }); });
  await assertFails(getDocs(collection(as(BIA), 'bannedUsers')));
  await assertFails(getDoc(doc(as(BIA), 'bannedUsers', CAIO)));
  await assertSucceeds(getDoc(doc(as(CAIO), 'bannedUsers', CAIO)));
  await assertSucceeds(getDocs(collection(as(MOD), 'bannedUsers')));
});

test('usuário bloqueado não publica, comenta, curte, segue, denuncia nem edita o perfil; continua lendo', async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'bannedUsers', CAIO), { reason: 'spam' }); });
  const caio = as(CAIO);
  await assertFails(addDoc(collection(caio, 'posts'), post({ authorId: CAIO })));
  await assertFails(addDoc(collection(caio, 'posts', 'post-bia', 'comments'), { authorId: CAIO, text: 'oi' }));
  await assertFails(setDoc(doc(caio, 'posts', 'post-bia', 'likes', CAIO), { userId: CAIO }));
  await assertFails(setDoc(doc(caio, 'followGraph', `${CAIO}_${BIA}`), { followerId: CAIO, followedId: BIA, status: 'ACCEPTED' }));
  await assertFails(addDoc(collection(caio, 'contentReports'), { reporterId: CAIO, targetId: 'post-bia', status: 'PENDING' }));
  await assertFails(updateDoc(doc(caio, 'users', CAIO), { bio: 'voltei' }));
  await assertSucceeds(getDoc(doc(caio, 'posts', 'post-bia')));
});

test('desbloquear: moderadora apaga o bloqueio e a pessoa volta a publicar', async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'bannedUsers', CAIO), { reason: 'spam' }); });
  await assertFails(deleteDoc(doc(as(BIA), 'bannedUsers', CAIO)));
  await assertSucceeds(deleteDoc(doc(as(MOD), 'bannedUsers', CAIO)));
  await assertSucceeds(addDoc(collection(as(CAIO), 'posts'), post({ authorId: CAIO })));
});

/** Ocultar = mover o post para moderatedPosts na mesma gravação. */
/** Lê um documento sem as regras (withSecurityRulesDisabled não devolve o valor da função). */
async function readRaw(path) {
  let data;
  await env.withSecurityRulesDisabled(async ctx => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
}

async function hidePostAs(uid, postId, change = {}) {
  const original = await readRaw(`posts/${postId}`);
  const db = as(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'moderatedPosts', postId), { post: { ...original, ...change }, hiddenBy: uid, hiddenAt: serverTimestamp(), reason: 'spam' });
  batch.delete(doc(db, 'posts', postId));
  return batch.commit();
}

test('ocultar post: só moderadora, sem alterar o conteúdo, e o post some do feed', async () => {
  await assertFails(hidePostAs(BIA, 'post-bia'));
  await assertFails(hidePostAs(MOD, 'post-bia', { text: 'editado pela moderação' }));
  await assertSucceeds(hidePostAs(MOD, 'post-bia'));
  await assertFails(getDoc(doc(as(BIA), 'posts', 'post-bia')));          // não existe mais para ninguém
  await assertFails(getDoc(doc(as(BIA), 'moderatedPosts', 'post-bia')));  // e a cópia é só da moderação
  await assertSucceeds(getDoc(doc(as(MOD), 'moderatedPosts', 'post-bia')));
});

test('ocultar sem apagar o original (cópia solta) é recusado', async () => {
  const db = as(MOD);
  await assertFails(setDoc(doc(db, 'moderatedPosts', 'post-bia'), { post: { authorId: BIA, isPrivate: false, text: 'público', createdAt: 2 }, hiddenBy: MOD, reason: '' }));
});

test('restaurar post oculto: volta igualzinho; com conteúdo trocado é recusado', async () => {
  await assertSucceeds(hidePostAs(MOD, 'post-bia'));
  const restore = async (uid, change = {}) => {
    const saved = (await readRaw('moderatedPosts/post-bia')).post;
    const db = as(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'posts', 'post-bia'), { ...saved, ...change });
    batch.delete(doc(db, 'moderatedPosts', 'post-bia'));
    return batch.commit();
  };
  await assertFails(restore(BIA));
  await assertFails(restore(MOD, { text: 'trocado' }));
  await assertSucceeds(restore(MOD));
  await assertSucceeds(getDoc(doc(as(BIA), 'posts', 'post-bia')));
});

// ---------- boas-vindas, convites e selo Fundador ----------
const newProfile = (uid, extra = {}) => ({ uid, displayName: 'Nova', followersCount: 0, createdAt: serverTimestamp(), ...extra });

test('boas-vindas: a pessoa grava até 5 gêneros favoritos e a data em que terminou (valor-limite)', async () => {
  const bia = doc(as(BIA), 'users', BIA);
  await assertSucceeds(updateDoc(bia, { favoriteGenres: ['fantasia', 'romance'], onboardedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(bia, { favoriteGenres: ['romance', 'fantasia', 'suspense', 'terror', 'poesia'] }));
  await assertFails(updateDoc(bia, { favoriteGenres: ['romance', 'fantasia', 'suspense', 'terror', 'poesia', 'hq'] }));
  await assertFails(updateDoc(bia, { favoriteGenres: ['fantasia', 'x'.repeat(5000)] }));   // só ids conhecidos
  await assertFails(updateDoc(bia, { favoriteGenres: [42] }));
  await assertFails(updateDoc(bia, { favoriteGenres: 'fantasia' }));
  await assertFails(updateDoc(bia, { onboardedAt: 'ontem' }));
});

test('conta nova: data de cadastro tem que ser a hora do servidor', async () => {
  await assertSucceeds(setDoc(doc(as('nova'), 'users', 'nova'), newProfile('nova')));
  await assertFails(setDoc(doc(as('velha'), 'users', 'velha'), newProfile('velha', { createdAt: new Date(2020, 0, 1) })));
});

test('ninguém muda a própria data de cadastro (protege o selo Fundador)', async () => {
  await assertSucceeds(setDoc(doc(as('nova'), 'users', 'nova'), newProfile('nova')));
  await assertFails(updateDoc(doc(as('nova'), 'users', 'nova'), { createdAt: new Date(2020, 0, 1) }));
});

test('convite: entra com o id de quem convidou, se for outra pessoa que existe', async () => {
  await assertSucceeds(setDoc(doc(as('nova'), 'users', 'nova'), newProfile('nova', { invitedBy: BIA })));
  await assertFails(setDoc(doc(as('eu'), 'users', 'eu'), newProfile('eu', { invitedBy: 'eu' })));
  await assertFails(setDoc(doc(as('x'), 'users', 'x'), newProfile('x', { invitedBy: 'fantasma' })));
  await assertFails(setDoc(doc(as('y'), 'users', 'y'), newProfile('y', { invitedBy: '<img onerror=1>' })));
});

test('convite: depois do cadastro, ninguém troca nem cria quem convidou', async () => {
  await assertSucceeds(setDoc(doc(as('nova'), 'users', 'nova'), newProfile('nova', { invitedBy: BIA })));
  await assertFails(updateDoc(doc(as('nova'), 'users', 'nova'), { invitedBy: CAIO }));
  await assertFails(updateDoc(doc(as(ANA), 'users', ANA), { invitedBy: BIA }));
});

test('convite: quem convidou consegue contar quantos entraram pelo link', async () => {
  await assertSucceeds(setDoc(doc(as('nova'), 'users', 'nova'), newProfile('nova', { invitedBy: BIA })));
  const snap = await assertSucceeds(getDocs(query(collection(as(BIA), 'users'), where('invitedBy', '==', BIA))));
  assert.equal(snap.size, 1);
});
