// ==========================================
// 1. IMPORTAÇÕES E CONFIGURAÇÃO DO FIREBASE
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, doc, increment, deleteDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; 
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyApGT3z1bxrX5cK3LMa63Ehsmll21zPqXI",
    authDomain: "cantinho-literario.firebaseapp.com",
    projectId: "cantinho-literario",
    storageBucket: "cantinho-literario.firebasestorage.app",
    messagingSenderId: "506794641201",
    appId: "1:506794641201:web:69bb5d8e78876856ee9210"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); 
const storage = getStorage(app); 
const comentariosRef = collection(db, "comentarios");

// ==========================================
// 2. CAPTURANDO ELEMENTOS (DOM)
// ==========================================
// Telas SPA
const telaFeed = document.getElementById('tela-feed');
const telaPerfil = document.getElementById('tela-perfil');
const btnMenuFeed = document.getElementById('btn-menu-feed');
const btnMenuPerfil = document.getElementById('btn-menu-perfil');

// Cabeçalho
const btnNotificacoes = document.getElementById('btn-notificacoes');
const btnConfiguracoes = document.getElementById('btn-configuracoes-perfil');
const btnSair = document.getElementById('btn-sair-sessao');

// Auth
const areaLogin = document.getElementById('area-login');
const camposCadastro = document.getElementById('campos-cadastro');
const btnMostrarCadastro = document.getElementById('btn-mostrar-cadastro');
const btnExecutarCadastro = document.getElementById('btn-executar-cadastro');
const btnEntrar = document.getElementById('btn-entrar');
const inputEmail = document.getElementById('email-login');
const inputSenha = document.getElementById('senha-login');
const inputUser = document.getElementById('cadastro-username');
const inputBio = document.getElementById('cadastro-bio');
const inputFotoPerfil = document.getElementById('cadastro-foto');

// Perfil e Estante
const miniNomeSidebar = document.getElementById('mini-nome-sidebar');
const miniFotoSidebar = document.getElementById('mini-foto-sidebar');
const miniFotoPadrao = document.getElementById('mini-foto-padrao');
const perfilNomeGrande = document.getElementById('perfil-nome-grande');
const perfilBioGrande = document.getElementById('perfil-bio-grande');
const perfilFotoGrande = document.getElementById('perfil-foto-grande');
const perfilFotoPadraoGrande = document.getElementById('perfil-foto-padrao-grande');

// Edição de Estante e Perfil
const btnAbrirEdicao = document.getElementById('btn-abrir-edicao');
const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
const btnSalvarEstante = document.getElementById('btn-salvar-estante');
const visualizacaoEstante = document.getElementById('visualizacao-estante');
const formularioEstante = document.getElementById('formulario-estante');
const txtLendoAgora = document.getElementById('txt-lendo-agora');
const txtFavorito = document.getElementById('txt-favorito');
const txtProximaLeitura = document.getElementById('txt-proxima-leitura');

// Campos de Input para Edição
const editLendoAgora = document.getElementById('edit-lendo-agora');
const editFavorito = document.getElementById('edit-favorito');
const editProximaLeitura = document.getElementById('edit-proxima-leitura');
const editFotoPerfil = document.getElementById('edit-foto-perfil');
const editUsername = document.getElementById('edit-username');
const editBio = document.getElementById('edit-bio');

// Postagem
const inputNomePost = document.getElementById('nome-usuario');
const inputTexto = document.getElementById('texto-comentario');
const inputLocalizacao = document.getElementById('localizacao-usuario'); 
const inputFotoLivro = document.getElementById('foto-livro'); 
const areaFotoLivro = document.getElementById('area-foto'); 
const btnEnviar = document.getElementById('btn-enviar');
const listaComentarios = document.getElementById('lista-comentarios');
const areaPostagem = document.getElementById('area-postagem'); 

const abaFeed = document.getElementById('aba-feed');
const abaTrocas = document.getElementById('aba-trocas');
let abaAtiva = 'resenha'; 
let usuarioLogado = null; 

// ==========================================
// FUNÇÃO DE SAUDAÇÃO DINÂMICA
// ==========================================
function atualizarSaudacao() {
    const horaAtual = new Date().getHours();
    const saudacaoElement = document.getElementById('saudacao-dinamica');
    
    if(!saudacaoElement) return;

    if (horaAtual >= 5 && horaAtual < 12) {
        saudacaoElement.innerText = "Bom dia com café! ☕";
    } else if (horaAtual >= 12 && horaAtual < 18) {
        saudacaoElement.innerText = "Boa tarde de leitura! 📖";
    } else {
        saudacaoElement.innerText = "Boa noite, hora de um capítulo! 🌙";
    }
}
atualizarSaudacao(); // Executa assim que carrega

// ==========================================
// 3. NAVEGAÇÃO SPA E CABEÇALHO
// ==========================================
btnMenuFeed.addEventListener('click', () => {
    telaFeed.style.display = 'block';
    telaPerfil.style.display = 'none';
    btnMenuFeed.className = 'botao-verde menu-ativo';
    btnMenuPerfil.style.border = '1px solid #edf2f0';
});

btnMenuPerfil.addEventListener('click', () => {
    if(!usuarioLogado) { alert("Faça login para acessar seu perfil!"); return; }
    telaFeed.style.display = 'none';
    telaPerfil.style.display = 'block';
    btnMenuFeed.className = 'botao-verde menu-inativo';
    btnMenuPerfil.style.border = '2px solid #2E7D32';
});

btnConfiguracoes.addEventListener('click', () => btnMenuPerfil.click());
btnNotificacoes.addEventListener('click', () => alert("Notificações em breve!"));
btnSair.addEventListener('click', () => signOut(auth));

function atualizarInterfacePostagem() {
    const todosPosts = document.querySelectorAll('.postagem');
    todosPosts.forEach(post => {
        if (abaAtiva === 'resenha') post.style.display = post.dataset.tipo === 'troca' ? 'none' : 'block';
        else post.style.display = post.dataset.tipo === 'troca' ? 'block' : 'none';
    });

    if (abaAtiva === 'resenha') {
        inputLocalizacao.style.display = 'none';
        areaFotoLivro.style.display = 'none';
        inputTexto.placeholder = "Compartilhe uma resenha literária com a comunidade...";
        btnEnviar.innerText = "Publicar Resenha";
    } else {
        inputLocalizacao.style.display = 'block';
        areaFotoLivro.style.display = 'block';
        inputTexto.placeholder = "Descreva o livro, conservação e o que procura em troca...";
        btnEnviar.innerText = "Publicar Troca";
    }
}

abaFeed.addEventListener('click', () => { abaFeed.classList.add('ativo'); abaTrocas.classList.remove('ativo'); abaAtiva = 'resenha'; atualizarInterfacePostagem(); });
abaTrocas.addEventListener('click', () => { abaTrocas.classList.add('ativo'); abaFeed.classList.remove('ativo'); abaAtiva = 'troca'; atualizarInterfacePostagem(); });

// ==========================================
// 4. LÓGICA DE USUÁRIO E ESTANTE
// ==========================================
async function carregarPerfil(uid) {
    try {
        const docRef = doc(db, "usuarios", uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const dados = docSnap.data();
            miniNomeSidebar.innerText = dados.username || "@Leitor";
            perfilNomeGrande.innerText = dados.username || "@Leitor";
            perfilBioGrande.innerText = dados.bio || "Sem bio definida.";
            inputNomePost.value = dados.username || "@Leitor";
            
            txtLendoAgora.innerText = dados.lendoAgora || "Viagem ao Centro da Terra";
            txtFavorito.innerText = dados.favorito || "Drácula";
            txtProximaLeitura.innerText = dados.proximaLeitura || "O Hobbit";

            if (dados.fotoURL) {
                miniFotoSidebar.src = dados.fotoURL; miniFotoSidebar.style.display = 'block'; miniFotoPadrao.style.display = 'none';
                perfilFotoGrande.src = dados.fotoURL; perfilFotoGrande.style.display = 'block'; perfilFotoPadraoGrande.style.display = 'none';
            }
        } else {
            const nomeAntigo = "@" + usuarioLogado.email.split('@')[0];
            miniNomeSidebar.innerText = nomeAntigo;
            perfilNomeGrande.innerText = nomeAntigo;
            perfilBioGrande.innerText = "Leitor veterano da plataforma.";
            inputNomePost.value = nomeAntigo;
        }
    } catch (error) { console.error("Erro perfil:", error); }
}

// ==========================================
// LÓGICA DE EDIÇÃO DO PERFIL COMPLETO
// ==========================================
btnAbrirEdicao.addEventListener('click', () => {
    visualizacaoEstante.style.display = 'none'; 
    formularioEstante.style.display = 'block'; 
    btnAbrirEdicao.style.display = 'none';
    
    // Preenche campos
    editLendoAgora.value = txtLendoAgora.innerText; 
    editFavorito.value = txtFavorito.innerText; 
    editProximaLeitura.value = txtProximaLeitura.innerText;
    editUsername.value = perfilNomeGrande.innerText;
    editBio.value = perfilBioGrande.innerText === "Sem bio definida." ? "" : perfilBioGrande.innerText;
});

btnCancelarEdicao.addEventListener('click', () => {
    visualizacaoEstante.style.display = 'block'; 
    formularioEstante.style.display = 'none'; 
    btnAbrirEdicao.style.display = 'inline-block';
});

btnSalvarEstante.addEventListener('click', async () => {
    if (!usuarioLogado) return;
    
    btnSalvarEstante.innerText = "Salvando..."; 
    btnSalvarEstante.disabled = true;

    try {
        let dadosAtualizados = {
            lendoAgora: editLendoAgora.value, 
            favorito: editFavorito.value, 
            proximaLeitura: editProximaLeitura.value,
            username: editUsername.value.startsWith('@') ? editUsername.value : '@' + editUsername.value,
            bio: editBio.value
        };

        let novaFotoURL = null;

        if (editFotoPerfil.files.length > 0) {
            const arquivo = editFotoPerfil.files[0];
            const refFoto = ref(storage, `fotos_perfil/${usuarioLogado.uid}`);
            await uploadBytes(refFoto, arquivo);
            novaFotoURL = await getDownloadURL(refFoto);
            dadosAtualizados.fotoURL = novaFotoURL;
        }

        await updateDoc(doc(db, "usuarios", usuarioLogado.uid), dadosAtualizados);

        txtLendoAgora.innerText = dadosAtualizados.lendoAgora; 
        txtFavorito.innerText = dadosAtualizados.favorito; 
        txtProximaLeitura.innerText = dadosAtualizados.proximaLeitura;
        perfilNomeGrande.innerText = dadosAtualizados.username;
        miniNomeSidebar.innerText = dadosAtualizados.username;
        inputNomePost.value = dadosAtualizados.username; 
        perfilBioGrande.innerText = dadosAtualizados.bio || "Sem bio definida.";

        if (novaFotoURL) {
            miniFotoSidebar.src = novaFotoURL; 
            miniFotoSidebar.style.display = 'block'; 
            miniFotoPadrao.style.display = 'none';
            perfilFotoGrande.src = novaFotoURL; 
            perfilFotoGrande.style.display = 'block'; 
            perfilFotoPadraoGrande.style.display = 'none';
        }

        editFotoPerfil.value = ""; 
        btnCancelarEdicao.click();
        
    } catch (error) { 
        console.error(error);
        alert("Erro ao salvar as alterações."); 
    } finally { 
        btnSalvarEstante.innerText = "Salvar Alterações"; 
        btnSalvarEstante.disabled = false; 
    }
});

// Autenticação
btnMostrarCadastro.addEventListener('click', () => { camposCadastro.style.display = 'block'; btnExecutarCadastro.style.display = 'inline-block'; btnEntrar.style.display = 'none'; btnMostrarCadastro.style.display = 'none'; });

btnExecutarCadastro.addEventListener('click', async () => {
    const email = inputEmail.value; const senha = inputSenha.value; const username = inputUser.value; const bio = inputBio.value;
    if (!email || !senha || !username) { alert("Preencha e-mail, senha e nome de usuário!"); return; }
    btnExecutarCadastro.innerText = "Criando..."; btnExecutarCadastro.disabled = true;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
        let fotoURL = "";
        if (inputFotoPerfil.files.length > 0) {
            const refFoto = ref(storage, `fotos_perfil/${userCredential.user.uid}`);
            await uploadBytes(refFoto, inputFotoPerfil.files[0]);
            fotoURL = await getDownloadURL(refFoto);
        }
        await setDoc(doc(db, "usuarios", userCredential.user.uid), { username: username.startsWith('@') ? username : '@' + username, bio: bio, fotoURL: fotoURL, email: email });
        location.reload();
    } catch (error) { alert("Erro: " + error.message); btnExecutarCadastro.innerText = "Finalizar Cadastro"; btnExecutarCadastro.disabled = false; }
});

btnEntrar.addEventListener('click', async () => { try { await signInWithEmailAndPassword(auth, inputEmail.value, inputSenha.value); inputEmail.value = ""; inputSenha.value = ""; } catch (error) { alert("Dados incorretos."); } });

onAuthStateChanged(auth, (user) => {
    if (user) {
        usuarioLogado = user; areaLogin.style.display = "none"; areaPostagem.style.display = "block"; btnSair.style.display = "inline-block"; carregarPerfil(user.uid);
    } else {
        usuarioLogado = null; areaLogin.style.display = "block"; areaPostagem.style.display = "none"; btnSair.style.display = "none";
        miniNomeSidebar.innerText = "Visitante"; miniFotoSidebar.style.display = 'none'; miniFotoPadrao.style.display = 'block';
        telaFeed.style.display = 'block'; telaPerfil.style.display = 'none';
    }
});

// ==========================================
// 5. POSTAGEM E FEED
// ==========================================
btnEnviar.addEventListener('click', async () => {
    if (!usuarioLogado) return; 
    const texto = inputTexto.value; const localizacao = inputLocalizacao.value; const isTroca = (abaAtiva === 'troca'); 
    if (texto.trim() === "") return;
    const txtOriginal = btnEnviar.innerText; btnEnviar.innerText = "Publicando..."; btnEnviar.disabled = true;
    try {
        let urlDaImagem = null;
        if (isTroca && inputFotoLivro.files.length > 0) {
            const refStorage = ref(storage, "fotos_livros/" + Date.now() + "_" + inputFotoLivro.files[0].name);
            await uploadBytes(refStorage, inputFotoLivro.files[0]); 
            urlDaImagem = await getDownloadURL(refStorage); 
        }
        await addDoc(comentariosRef, { nome: inputNomePost.value, texto: texto, localizacao: isTroca ? localizacao : "", imagem: urlDaImagem, data: serverTimestamp(), curtidas: 0, uid: usuarioLogado.uid, tipo: abaAtiva, emailContato: usuarioLogado.email });
        inputTexto.value = ""; inputLocalizacao.value = ""; inputFotoLivro.value = "";
    } catch (error) { alert("Erro ao postar."); } finally { atualizarInterfacePostagem(); btnEnviar.innerText = txtOriginal; btnEnviar.disabled = false; }
});

onSnapshot(query(comentariosRef, orderBy("data", "desc")), (snapshot) => {
    listaComentarios.innerHTML = ""; 
    snapshot.forEach((documento) => {
        const com = documento.data(); const postId = documento.id; 
        let dataFormatada = "agora mesmo"; 
        if (com.data) dataFormatada = com.data.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        const ehMeuPost = usuarioLogado && (com.uid === usuarioLogado.uid);
        const tipoPost = com.tipo || 'resenha'; 

        const divComentario = document.createElement('div');
        divComentario.className = "postagem"; divComentario.dataset.tipo = tipoPost; 
        if (abaAtiva !== tipoPost) divComentario.style.display = 'none'; 

        divComentario.innerHTML = `
            <div style="display: flex; justify-content: space-between;">
                <p style="margin: 0 0 10px 0;"><strong>${com.nome}</strong> ${tipoPost === 'troca' ? '📦' : ''} ${com.localizacao ? `<span style="color:#81C784; font-size:0.9em; margin-left:10px;">📍 ${com.localizacao}</span>` : ""} <br> <span style="color:#888; font-size:0.85em;">${dataFormatada}</span></p>
                ${ehMeuPost ? `<button class="btn-excluir" style="background:none; border:none; cursor:pointer; font-size:1.2rem;">🗑️</button>` : ""}
            </div>
            <p style="margin-bottom: 15px;">${com.texto}</p>
            ${com.imagem ? `<img src="${com.imagem}" style="max-width:100%; border-radius:8px; margin-bottom:15px; border:1px solid #edf2f0; max-height:400px; object-fit:cover;">` : ""}
            <div class="acoes-post">
                <button class="botao-verde btn-curtir">💖 <span>${com.curtidas || 0}</span></button>
                ${tipoPost === 'troca' ? `<button class="botao-verde btn-trocar">🤝 Propor Troca</button>` : `<button class="botao-verde btn-abrir-respostas" style="background:transparent; color:#2E7D32; border:1px solid #81C784;">💬 Responder</button>`}
            </div>
            <div class="sessao-respostas" style="display:none; margin-top:15px; padding-top:15px; border-top:1px dashed #edf2f0;">
                <div class="lista-respostas" style="margin-bottom:10px; font-size:0.9em; max-height:200px; overflow-y:auto;"></div>
                <div style="display:flex; gap:5px;"><input type="text" class="input-resposta" placeholder="Escreva..." style="flex:1;"><button class="botao-verde btn-enviar-resposta">Enviar</button></div>
            </div>
        `;

        // ==========================================
        // ANIMAÇÃO DE CURTIDA LIGADA
        // ==========================================
        divComentario.querySelector('.btn-curtir').addEventListener('click', async (e) => { 
            if (!usuarioLogado) { alert("Faça login para curtir!"); return; }
            
            const botaoClicado = e.currentTarget;
            botaoClicado.classList.add('animacao-pulsar');
            setTimeout(() => { botaoClicado.classList.remove('animacao-pulsar'); }, 300);

            try { await updateDoc(doc(db, "comentarios", postId), { curtidas: increment(1) }); } catch (error) {}
        });
        
        if (ehMeuPost) divComentario.querySelector('.btn-excluir').addEventListener('click', async () => { if (confirm("Deseja excluir?")) await deleteDoc(doc(db, "comentarios", postId)); });

        if (tipoPost === 'troca') {
            divComentario.querySelector('.btn-trocar').addEventListener('click', () => {
                if (usuarioLogado && com.emailContato) window.location.href = `mailto:${com.emailContato}?subject=Troca Cantinho Literario&body=Ola ${com.nome}, vi seu post...`;
            });
        } else {
            const btnAbrirResp = divComentario.querySelector('.btn-abrir-respostas');
            const sessaoResp = divComentario.querySelector('.sessao-respostas');
            const listaResp = divComentario.querySelector('.lista-respostas');
            const btnEnvResp = divComentario.querySelector('.btn-enviar-resposta');
            const inpResp = divComentario.querySelector('.input-resposta');
            let listenerResp = null; 

            btnAbrirResp.addEventListener('click', () => {
                if (sessaoResp.style.display === 'none') {
                    sessaoResp.style.display = 'block'; btnAbrirResp.innerText = "Esconder Comentários";
                    listenerResp = onSnapshot(query(collection(db, "comentarios", postId, "respostas"), orderBy("data", "asc")), (snap) => {
                        listaResp.innerHTML = "";
                        snap.forEach(d => { const r = d.data(); listaResp.innerHTML += `<div style="background:#f9fbf9; padding:8px; border-radius:8px; margin-bottom:5px;"><strong>${r.nome}:</strong> ${r.texto}</div>`; });
                    });
                } else { sessaoResp.style.display = 'none'; btnAbrirResp.innerText = "💬 Responder"; if (listenerResp) listenerResp(); }
            });

            btnEnvResp.addEventListener('click', async () => {
                if (!usuarioLogado || !inpResp.value.trim()) return;
                btnEnvResp.innerText = "..."; btnEnvResp.disabled = true;
                await addDoc(collection(db, "comentarios", postId, "respostas"), { nome: inputNomePost.value, texto: inpResp.value.trim(), uid: usuarioLogado.uid, data: serverTimestamp() });
                inpResp.value = ""; btnEnvResp.innerText = "Enviar"; btnEnvResp.disabled = false;
            });
        }
        listaComentarios.appendChild(divComentario);
    });
});