// Testes das regras do Firestore. Rodam no emulador local (não tocam no banco real):
//   npm install && npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

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
