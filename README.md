# Mirante — colocar no ar

## 1) Rodar o SQL no Supabase
No painel do Supabase (o seu projeto): **SQL Editor → New query**, cole o conteúdo
do arquivo `supabase-setup.sql` e clique em **Run**. Isso cria a tabela onde ficam
os imóveis e reservas, protegida por RLS (só quem estiver logado consegue ler/gravar).

## 2) Criar o usuário de login
No painel do Supabase: **Authentication → Users → Add user**.
- Email: `bitridedestinos@gmail.com`
- Password: escolha a senha que a equipe vai usar para entrar no Mirante
  (essa é a senha real agora — pode trocar quando quiser, direto ali no painel).
- Marque a opção de já confirmar o e-mail automaticamente (se aparecer), assim
  não precisa clicar em nenhum link de confirmação.

## 3) Configurar as variáveis de ambiente
Copie `.env.example` para um arquivo chamado `.env` (mesma pasta) e confira se os
valores de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são os do seu projeto
(já vêm preenchidos com os que você me passou).

## 4) Testar localmente (opcional)
Se quiser testar no seu computador antes de publicar:
```
npm install
npm run dev
```
Abre em `http://localhost:5173`.

## 5) Subir para o GitHub
Crie um repositório novo no GitHub e suba esta pasta inteira (pode ser privado).

## 6) Publicar no Vercel
No painel do Vercel: **Add New → Project → Import** o repositório do GitHub.
Antes de clicar em Deploy, abra **Environment Variables** e adicione:
- `VITE_SUPABASE_URL` → `https://akuzpakvsvyywhhgkuyj.supabase.co`
- `VITE_SUPABASE_ANON_KEY` → `sb_publishable_9kqunJY6cZ-0BejPjw5jLA_NUwwShgc`

Clique em **Deploy**. Em ~1 minuto o Vercel te dá um link tipo
`mirante.vercel.app` já funcionando.

## 7) Domínio próprio (quando quiser)
No painel do Vercel: **Project → Settings → Domains → Add**, coloque seu domínio
(ex: `mirante.com.br`) e siga as instruções de DNS que o Vercel mostrar (é só
apontar uns registros no seu registrador, tipo Registro.br).

---

**Sobre a senha:** agora ela não fica mais escrita no código — é validada de
verdade pelo Supabase Auth. Pra trocar a senha, é só ir em Authentication → Users
→ clicar no usuário → Reset password, direto no painel do Supabase.
