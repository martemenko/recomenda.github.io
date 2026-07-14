# Recomenda Cine — Frontend

React + Vite + Tailwind + React Router + supabase-js. Efeito "sempre parece celular" via container de largura fixa (480px) centralizado, mesmo no desktop.

## Setup

```bash
npm install
cp .env.example .env
# edite .env com sua VITE_SUPABASE_ANON_KEY real
npm run dev
```

Abre em `http://localhost:5173`.

## Estrutura

```
src/
├── lib/
│   ├── supabaseClient.js   # cliente supabase-js + helper pra chamar Edge Functions
│   ├── auth.jsx            # contexto de autenticação (sessão + perfil)
│   └── format.js           # formatação de duração (anos/meses/dias/horas)
├── components/
│   ├── MobileShell.jsx      # container de largura fixa
│   ├── BottomTabBar.jsx     # navegação inferior (Séries/Filmes/Explorar/Perfil)
│   ├── TopBar.jsx / SubTabs.jsx / SectionLabel.jsx
│   ├── EpisodioRow.jsx      # linha de episódio (estilo TV Time)
│   └── PosterCard.jsx       # card de pôster (grid)
└── pages/
    ├── Login.jsx
    ├── SeriesPage.jsx       # Minha Lista (assistir a seguir / sem assistir há tempo / histórico) + Em breve
    ├── FilmesPage.jsx       # Minha Lista (quero ver) + Em breve (por gênero)
    ├── Explorar.jsx         # busca + trending agregado
    ├── Perfil.jsx           # estatísticas, listas, histórico
    ├── Configuracoes.jsx    # privacidade, importar/exportar, excluir conta
    └── TituloDetalhe.jsx    # ficha de título: sinopse, elenco, nota, episódios
```

## Deploy no GitHub Pages

```bash
npm install --save-dev gh-pages
npm run deploy
```

Isso builda e publica a pasta `dist/` na branch `gh-pages`. Ative isso em **Settings → Pages** do repositório, apontando pra branch `gh-pages`.

**Importante:** as variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` do `.env` ficam embutidas no build final (isso é esperado e seguro — é a `anon` key, feita pra ser pública, protegida pelo RLS que já validamos).

## Simplificações conscientes desta primeira versão

Pra manter o escopo administrável nessa primeira entrega, ficaram de fora (ou simplificados) alguns pontos que você pode querer refinar depois:

- **i18n da interface** (textos fixos tipo "Quero ver", "Assistir a seguir") ainda estão hardcoded em português. O conteúdo (sinopse/elenco) já usa `obter-titulo-traduzido`/`obter-episodio-traduzido` com fallback pra inglês, mas os *rótulos da UI* precisam do `react-i18next` configurado à parte.
- **Consultas client-side em vez de RPC**: a lógica de "assistir a seguir"/"sem assistir há tempo" (em `SeriesPage.jsx`) roda inteira no navegador a partir de queries simples. Funciona bem em escala pessoal; se a lista de séries crescer muito, vale mover esse cálculo pra uma view/function no Postgres.
- **Importação de CSV** (`Configuracoes.jsx`) faz busca por nome (não por ID exato), então títulos com nomes muito diferentes do oficial podem não casar de primeira — a lista de "não encontrados" ao final avisa quais.
- **Paginação**: listas de "Em breve" e "Explorar" só pegam a primeira página de resultados por enquanto.
- **Confirmação de "assistir a seguir"** considera só episódios com `launch_date` já passada — isso depende de `season_number`/`episode_number`/`launch_date` estarem preenchidos, o que só vale pros títulos ingeridos depois da correção que fizemos nesses campos.
