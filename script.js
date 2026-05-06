// ==========================================
// 1. SORTEIO DE PERGUNTAS (Quebra-Gelo)
// ==========================================
const perguntasQuebraGelo = [
    "Qual livro de fantasia te fez esquecer do tempo?",
    "Qual o seu mangá favorito e por quê?",
    "Se você pudesse viver dentro de um livro de aventura, qual seria?",
    "Qual vilão da literatura você acha que tinha razão?",
    "Que livro você acabou de ler e precisa desesperadamente comentar com alguém?"
];

// ==========================================
// 2. MEMÓRIA DO NAVEGADOR (Local Storage)
// ==========================================
const feedPrincipal = document.querySelector('.feed-principal');
const caixaCriarPostagem = document.querySelector('.criar-postagem');

// Função para criar o elemento visual da postagem
function criarElementoPostagem(conteudo) {
    const novaPostagem = document.createElement('div');
    novaPostagem.classList.add('postagem'); 
    
   novaPostagem.innerHTML = `
        <p class="autor">
            <strong>@NovoLeitor</strong> 
            <span class="badge badge-acolhedor">🌟 Novo</span>
            • agora mesmo
        </p>
        <p>${conteudo}</p>
        <div class="acoes-post">
            <button class="botao-verde btn-curtir">💖 <span class="contador">0</span></button>
            <button class="botao-verde btn-abrir-comentarios">💬 Comentar</button>
        </div>
        
        <!-- NOVA ÁREA DE COMENTÁRIOS (Invisível no começo) -->
        <div class="area-comentarios">
            <div class="lista-comentarios"></div>
            <div class="caixa-escrever-comentario">
                <input type="text" class="input-comentario" placeholder="Escreva sua resposta...">
                <button class="botao-verde btn-enviar-comentario">Enviar</button>
            </div>
        </div>
    `;
    
    // Insere a nova postagem logo APÓS a caixa de criar postagem
    caixaCriarPostagem.insertAdjacentElement('afterend', novaPostagem);
}

// Função para carregar posts salvos quando a página abre
function carregarPostagensSalvas() {
    // Busca no "HD" do navegador. Se não tiver nada, cria um array vazio []
    const postsSalvos = JSON.parse(localStorage.getItem('historicoPosts')) || [];
    
    // Precisamos ler de trás pra frente para manter a ordem correta no topo do feed
    for (let i = postsSalvos.length - 1; i >= 0; i--) {
        criarElementoPostagem(postsSalvos[i]);
    }
}

// ==========================================
// 3. AÇÃO DE PUBLICAR
// ==========================================
const btnPublicar = document.getElementById('btn-publicar');

btnPublicar.addEventListener('click', function() {
    const caixaTexto = document.getElementById('caixa-post');
    const conteudo = caixaTexto.value;

    if (conteudo.trim() === '') {
        alert('Escreva algo para compartilhar com a comunidade!');
        return; 
    }

    // Cria visualmente na tela
    criarElementoPostagem(conteudo);

    // Salva na memória do navegador (Local Storage)
    const postsSalvos = JSON.parse(localStorage.getItem('historicoPosts')) || [];
    postsSalvos.push(conteudo); // Adiciona o novo texto no array
    localStorage.setItem('historicoPosts', JSON.stringify(postsSalvos)); // Salva de volta

    // Limpa a caixa de texto
    caixaTexto.value = '';
});

// ==========================================
// 4. AÇÃO DE CURTIR (Delegação de Eventos)
// ==========================================
// Como novas postagens são criadas toda hora, escutamos os cliques no feed inteiro
feedPrincipal.addEventListener('click', function(event) {
    
    // Verifica se o lugar que clicamos foi em um botão com a classe 'btn-curtir'
    const botaoClicado = event.target.closest('.btn-curtir');
    
    if (botaoClicado) {
        // Encontra o numero (span) dentro do botão específico que foi clicado
        const spanContador = botaoClicado.querySelector('.contador');
        
        // Pega o número atual, soma 1 e devolve pra tela
        let curtidasAtuais = parseInt(spanContador.innerText);
        spanContador.innerText = curtidasAtuais + 1;
    }
    // ... (Lógica do curtir já existente acima disso) ...

    // LÓGICA 2: ABRIR/FECHAR A ÁREA DE COMENTÁRIOS
    const btnAbrir = event.target.closest('.btn-abrir-comentarios');
    if (btnAbrir) {
        const postagemAtual = btnAbrir.closest('.postagem'); // Acha a postagem dona do botão
        const areaComentarios = postagemAtual.querySelector('.area-comentarios');
        
        // Se estiver escondido, mostra. Se estiver aparecendo, esconde (Efeito Toggle)
        if (areaComentarios.style.display === 'block') {
            areaComentarios.style.display = 'none';
        } else {
            areaComentarios.style.display = 'block';
        }
    }

    // LÓGICA 3: ENVIAR O COMENTÁRIO
    const btnEnviar = event.target.closest('.btn-enviar-comentario');
    if (btnEnviar) {
        const postagemAtual = btnEnviar.closest('.postagem');
        const inputComentario = postagemAtual.querySelector('.input-comentario');
        const textoComentario = inputComentario.value;

        // Só cria o comentário se a pessoa digitou algo
        if (textoComentario.trim() !== '') {
            const listaDeComentarios = postagemAtual.querySelector('.lista-comentarios');
            
            // Cria a div do comentário novo
            const novoComentario = document.createElement('div');
            novoComentario.classList.add('comentario');
            novoComentario.innerHTML = `<strong>@Visitante:</strong> ${textoComentario}`;
            
            // Injeta o comentário na lista e limpa o campo de texto
            listaDeComentarios.appendChild(novoComentario);
            inputComentario.value = ''; 
        }
    }
});

// ==========================================
// 5. INICIALIZAÇÃO DO SITE
// ==========================================
window.onload = function() {
    // Sorteia a pergunta
    const caixaPost = document.getElementById('caixa-post');
    const sorteio = Math.floor(Math.random() * perguntasQuebraGelo.length);
    caixaPost.setAttribute('placeholder', perguntasQuebraGelo[sorteio]);

    // Puxa as postagens da memória
    carregarPostagensSalvas();
};

// Interações do Menu Lateral
document.getElementById('btn-inicio').addEventListener('click', () => alert('🏠 Início!'));
document.getElementById('btn-trocas').addEventListener('click', () => alert('🤝 Minhas Trocas!'));