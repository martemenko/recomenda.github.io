# Como trazer o schema do banco para o git (governança de versionamento)

Este projeto ainda não tem o schema do Postgres versionado — ele existe só no
projeto remoto do Supabase. Siga os passos abaixo na sua máquina (assumindo
que o Supabase CLI já está instalado) para gerar a primeira migration
autoritativa a partir do banco real.

## 1. Login no CLI

```bash
supabase login
```

Abre o navegador para autenticar e salva um access token localmente
(não versionado — fica fora do repo).

## 2. Descobrir o project ref

No dashboard do Supabase: **Project Settings > General > Reference ID**.
Ou via CLI:

```bash
supabase projects list
```

## 3. Linkar o repo ao projeto remoto

Na raiz do repo (onde já existe `supabase/config.toml`):

```bash
supabase link --project-ref <SEU_PROJECT_REF>
```

Vai pedir a senha do banco (Project Settings > Database > Connection string).
Essa informação fica em `supabase/.temp/`, que já está no `.gitignore` — não
sobe pro git.

## 4. Puxar o schema real

```bash
supabase db pull
```

Isso introspecciona o banco remoto e cria um arquivo novo aqui em
`supabase/migrations/`, com timestamp automático (ex:
`20260803123456_remote_schema.sql`). Esse arquivo deve conter:

- Todas as tabelas, colunas, constraints e FKs
- Índices
- Políticas de RLS
- Views (ex: `trending_semana`, usada na aba Explorar)
- Funções e triggers

O CLI também marca essa migration como **já aplicada** no histórico remoto
automaticamente — não é necessário (e não se deve) rodar `supabase db push`
depois deste primeiro pull, já que as tabelas já existem no banco.

## 5. Revisar e commitar

Abra o arquivo gerado, confira se bate com o que você espera, e comite:

```bash
git add supabase/migrations/
git commit -m "Add baseline schema migration from supabase db pull"
```

## Daqui pra frente: como evoluir o schema com governança

Depois deste primeiro pull, trate `supabase/migrations/` como fonte de
verdade. Para qualquer mudança de schema (nova tabela, coluna, índice):

1. Criar uma migration nova (não editar o dashboard direto):
   ```bash
   supabase migration new nome_da_mudanca
   ```
2. Escrever o SQL da mudança no arquivo gerado.
3. Testar localmente (requer Docker Desktop rodando):
   ```bash
   supabase start
   supabase db reset
   ```
4. Aplicar no remoto:
   ```bash
   supabase db push
   ```
5. Commitar o arquivo da migration.

Isso garante que toda alteração de schema — incluindo a futura tabela
`games` para a feature do IGDB — fique versionada e auditável no git, em vez
de só existir como um estado implícito no dashboard.
