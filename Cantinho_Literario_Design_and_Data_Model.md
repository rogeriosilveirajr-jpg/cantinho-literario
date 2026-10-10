# Cantinho Literário — Design iOS e Modelagem Firestore

## 1. Visão Geral

Cantinho Literário é uma rede social acolhedora para leitores, com foco em:
- feed principal de microblogging estilo Twitter
- truncamento de textos longos com "Ver mais..." estilo Instagram
- suporte nativo a posts com foto + texto
- perfil estilo TikTok com navegação por abas deslizáveis
- compliance Apple App Store para privacidade, moderação UGC e login Apple

## 2. Arquitetura Visual e Jornada de Usuário

### 2.1 Tela de Login / Onboarding
- Safe area completa para notch / Dynamic Island
- `Sign in with Apple` em destaque como botão primário
- `Entrar com Google` como botão secundário
- Texto de apoio sobre privacidade e controle de dados
- Link opcional `Entrar com e-mail`

### 2.2 Feed Principal
- Bottom tab bar nativo com:
  - Home
  - Doações / Trocas
- Card de postagem com:
  - avatar, nome, @handle
  - badge de "Privado" com ícone de cadeado quando necessário
  - imagem do livro
  - texto truncado em 3 linhas
  - link "Ver mais..." para expansão inline
  - botões de ação com touch target mínimo de 44x44pt: curtir, comentar, compartilhar
  - menu de contexto `⋯` para opções de moderação

### 2.3 Feed de Doações / Trocas
- Mesmo layout de card do feed principal
- Tag visual de "Doação" ou "Troca"
- Filtro no topo: `Todas | Doações | Trocas`
- CTA leve no card: "Tenho interesse"

### 2.4 Perfil do Usuário (TikTok Style)
- Header fixo com:
  - avatar 88x88pt
  - nome, @handle e bio curta
  - botão `Seguir` / `Seguindo`
  - ícone de cadeado se perfil privado
  - métricas: posts / seguidores / seguindo
- Navegação por abas deslizáveis:
  - Postagens
  - TBA (Leituras Futuras)
  - Lidos
  - Lista de Desejos
- Swipe horizontal entre abas e toque no segmento
- Conteúdo por aba:
  - Postagens: cards verticais
  - TBA / Lidos / Wishlist: grid ou lista de livros com capa, título, autor, nota

### 2.5 Configurações e Exclusão de Conta
- Seção de `Privacidade`: switch público / privado
- Seção de `Segurança`: botão `Excluir Conta Definitivamente`
- Microcopy explicando a diretriz Apple 5.1.1(v)
- Ações e botões com tamanho mínimo 44x44pt

### 2.6 Bottom Sheets e Modais
- Bottom sheet nativo iOS para ações de post:
  - Denunciar Conteúdo
  - Bloquear Usuário
  - Copiar Link
  - Cancelar
- Gesto de arrastar para baixo para fechar
- Modal full-screen para criação de post

## 3. Design System

### 3.1 Paleta de Cores
- `#F7F2EA` — fundo
- `#FFF8EE` — superfície
- `#7F5C3B` — primária
- `#2A1F17` — texto principal
- `#6C5A4A` — texto secundário
- `#7B8E74` — accent / sucesso
- `#C64747` — destrutivo
- `#D8C9BB` — divider

### 3.2 Tipografia
- Fonte iOS nativa: SF Pro Text / Display
- Escalas recomendadas:
  - Heading: 28pt
  - Title: 22pt
  - Body: 17pt
  - Subhead: 15pt
  - Caption: 13pt
- Suporte a Dynamic Type e tamanhos de acessibilidade

### 3.3 Componentes
- Cards: canto 16pt, sombra suave, padding 16pt
- Botões: altura mínima 44pt, canto 12–16pt
- Espaçamento base: 16pt; gaps secundários: 12pt / 20pt
- Ícones simples e leitura de contraste
- Texto truncado em 3 linhas com `Ver mais...`

## 4. Modelagem de Dados Firestore

### 4.1 Coleções principais
- `users`
- `follow_graph`
- `posts`
- `posts/{postId}/comments`
- `posts/{postId}/likes`
- `user_books`
- `content_reports`
- `user_blocks`
- `user_feed`

### 4.2 Estrutura de documentos

#### `users/{userId}`
- `displayName`
- `handle`
- `bio`
- `avatarUrl`
- `privacy`: `public` | `private`
- `followerCount`
- `followingCount`
- `postCount`
- `booksCounts`: `{ postagens, tba, lidos, wishlist }`
- `authProviders`: `{ firebaseUid, appleId, googleId }`
- `status`: `active` | `pending_deletion` | `deleted`
- `createdAt`, `updatedAt`
- `deletionRequestedAt`

#### `follow_graph/{followerId_followeeId}`
- `followerId`
- `followeeId`
- `status`: `PENDING` | `ACCEPTED`
- `requestedAt`
- `acceptedAt`
- `updatedAt`
- ID: `${followerId}_${followeeId}`

#### `posts/{postId}`
- `ownerId`
- `ownerHandle`
- `ownerName`
- `ownerAvatarUrl`
- `text`
- `imageUrls`
- `isDonation`
- `isTrade`
- `createdAt`, `updatedAt`
- `likeCount`
- `commentCount`
- `tags`
- `blocked`

#### `posts/{postId}/comments/{commentId}`
- `commenterId`
- `commenterHandle`
- `commenterName`
- `text`
- `createdAt`
- `likeCount`
- `parentCommentId`

#### `posts/{postId}/likes/{userId}`
- `userId`
- `createdAt`

#### `user_books/{bookId}`
- `ownerId`
- `shelf`: `POSTAGENS` | `TBA` | `LIDOS` | `WISHLIST`
- `title`
- `author`
- `coverUrl`
- `notes`
- `addedAt`
- `updatedAt`

#### `content_reports/{reportId}`
- `reporterId`
- `targetType`: `POST` | `COMMENT` | `USER`
- `targetId`
- `targetOwnerId`
- `reason`
- `details`
- `status`: `OPEN` | `REVIEWED` | `RESOLVED`
- `createdAt`, `reviewedAt`

#### `user_blocks/{blockerId_blockedId}`
- `blockerId`
- `blockedId`
- `createdAt`
- ID: `${blockerId}_${blockedId}`

#### `user_feed/{userId}/timeline/{entryId}`
- `postId`
- `ownerId`
- `ownerHandle`
- `ownerAvatarUrl`
- `textPreview`
- `imageUrl`
- `isDonation`
- `isTrade`
- `createdAt`
- `postCreatedAt`

## 5. Estratégia de Leitura do Feed

- `posts` armazena a fonte de verdade do conteúdo.
- `user_feed` é um feed denormalizado para cada usuário.
- O app consulta `user_feed/{currentUserId}/timeline` com `orderBy(createdAt, desc)` e `limit(20)`.
- Paginação: `startAfter(lastDoc)`.
- O feed de Doações/Trocas pode ser filtrado por `isDonation == true` ou manter coleção separada.
- A denormalização reduz joins e traz alta performance em Firestore.

## 6. Regras de Negócio e Privacidade

### 6.1 Conta Pública / Privada
- `public`: qualquer usuário lê posts e livros.
- `private`: apenas seguidores aceitos (`status = ACCEPTED`) leem posts e livros.
- Seguir perfil privado cria `follow_graph` com `status = PENDING`.
- Perfil público permite `ACCEPTED` imediato.

### 6.2 Follow Graph Assimétrico
- Relacionamento assimétrico por documento único.
- Sem documento = `NONE`.
- Permite requests pendentes e aceitações manuais.

### 6.3 Bloqueios
- `user_blocks` impede:
  - retorno de posts no feed
  - leitura de perfil e conteúdos bloqueados
  - envio de follow requests
- As consultas e regras de segurança devem checar bloqueios em ambas as direções.

### 6.4 Moderação UGC
- Todo post deve ter menu `⋯` com:
  - Denunciar Conteúdo
  - Bloquear Usuário
- Denúncias persistem em `content_reports`.

### 6.5 Autenticação
- `users.authProviders` armazena:
  - `firebaseUid`
  - `appleId`
  - `googleId`
- Suporta login Apple obrigatório e login Google.

## 7. Exclusão de Conta e Data Deletion

### 7.1 Fluxo de exclusão
- Botão `Excluir Conta Definitivamente` em Configurações.
- Usuário confirma a exclusão.
- Atualizar `users/{userId}.status = pending_deletion` e `deletionRequestedAt = timestamp`.
- Backend ou Cloud Function processa a exclusão em cascata.

### 7.2 Soft delete / Hard delete
- Soft delete: oculta usuário imediatamente, mantém documento até exclusão completa.
- Hard delete:
  - remover `users/{userId}`
  - remover `posts` do usuário
  - remover `posts/{postId}/comments` e `posts/{postId}/likes`
  - remover `user_books`
  - remover `follow_graph` relacionados
  - remover `content_reports` e `user_blocks` relacionados
- Opcional: `deleted_users_archive/{userId}` para auditoria antes da remoção final.

## 8. Firestore Security Rules — Lógica

### 8.1 Leitura de perfis
- Permitir leitura de `users/{userId}` se:
  - `privacy == public`
  - ou `request.auth.uid == userId`
  - ou segue aceito: `follow_graph/{requesterId_userId}.status == "ACCEPTED"`

### 8.2 Leitura de posts
- Permitir leitura de `posts/{postId}` se:
  - autor público
  - ou requester é autor
  - ou follow aceito entre requester e autor
- Negar se há bloqueio:
  - `user_blocks/{request.auth.uid}_${ownerId}` existe
  - ou `user_blocks/${ownerId}_${request.auth.uid}` existe

### 8.3 Mesma lógica para:
- `posts/{postId}/comments`
- `posts/{postId}/likes`
- `user_books`

### 8.4 Escrita segura
- `content_reports`: `reporterId == request.auth.uid`
- `user_blocks`: `blockerId == request.auth.uid`
- `follow_graph`: `followerId == request.auth.uid`
- `users/{userId}`: somente o próprio usuário pode atualizar campos permitidos
- `status` e `authProviders`: controlados pelo backend

### 8.5 Bloqueio de acesso
- Negar leitura sempre que houver bloqueio em qualquer direção entre requester e owner.

## 9. Recomendações de Navegação

- Navegação com bottom tab bar nativo.
- Gestos do iOS para swipe entre abas do perfil.
- Bottom sheet para ações de moderação.
- Modal full-screen para criação de post.
- Botões e touch targets compatíveis com HIG.

## 10. Conclusão

Essa proposta entrega:
- UX iOS alinhada com as Human Interface Guidelines
- navegação e touch targets móveis bem dimensionados
- design acolhedor com paleta de tons de papel e tipografia de alta legibilidade
- modelagem Firestore preparada para performance e privacidade
- suporte obrigatório a login Apple / Google e UGC Moderation
- exclusão de conta e compliance de data deletion para App Store

## 11. Suporte Cross-Platform para Google Play

### 11.1 Plataforma
- O app deve ser construído com uma camada compartilhada que funcione em iOS e Android, como React Native ou Flutter.
- O backend Firestore / Firebase Auth / Storage pode ser o mesmo para ambas as plataformas.
- A interface deve respeitar tanto o HIG da Apple quanto as diretrizes de Material Design do Google, aplicando adaptações de plataforma onde necessário.

### 11.2 Navegação e componentes
- Use bottom navigation nativo em Android e tab bar nativo em iOS, mantendo consistência visual e usabilidade.
- Adapte o header para Android com App Bar e ícones de ação no canto direito, mantendo o mesmo fluxo funcional.
- Preserve bottom sheets para ações de moderação em ambas as plataformas, utilizando componentes nativos de Modal Bottom Sheet em Android e UISheetPresentationController em iOS.
- Em Android, respeite status bar / gesture navigation e o espaçamento de sistema usando `SafeAreaView` ou `MediaQuery` / `Insets`.

### 11.3 Tipografia e estilo
- No iOS, use SF Pro; no Android, use Roboto / Material typography se fizer sentido para o usuário Android.
- Mantenha a mesma paleta de cores e a sensação acolhedora em ambas as plataformas.
- Ajuste a iconografia para seguir o estilo de cada plataforma, mas preserve a identidade visual da marca.

### 11.4 Login e autenticação
- Em iOS, ofereça `Sign in with Apple` e `Entrar com Google`.
- Em Android, ofereça `Entrar com Google` como principal fluxo e, se desejar apoiar o mesmo conjunto de contas, mantenha também `Sign in with Apple` como opção adicional para usuários Apple ID que usem Android.
- Use Firebase Auth para suportar ambos os sistemas de login com identificadores independentes.

### 11.5 Play Store Compliance
- Garanta que a política de UGC também esteja presente para o Google Play: menu de `Denunciar Conteúdo`, `Bloquear Usuário`, e processo claro de moderação.
- Inclua a política de privacidade, termos de uso e a opção de exclusão de conta no app, conforme exigido pelo Google Play.
- Mantenha o mesmo modelo de denúncia e bloqueio em `content_reports` e `user_blocks` para ambas as lojas.

---

Se quiser, posso gerar também:
- wireframes textuais detalhados por tela
- diagrama de navegação para React Native ou Swift
- exemplo de `firestore.rules` completo para este modelo
