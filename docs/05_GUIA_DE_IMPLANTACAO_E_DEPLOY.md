# 🚀 05. Guia de Implantação e Deploy em Produção

Este guia fornece as diretrizes para publicar a aplicação em ambientes de produção de alta disponibilidade utilizando **Netlify**, **Supabase** e **Cloud Run / Docker**.

---

## 1. Configuração do Supabase

### 1.1 Criando o Projeto
1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
2. Guarde as credenciais:
   - `Project URL`: Exemplo: `https://xyzcompany.supabase.co`
   - `anon public key`: Chave pública para o frontend
   - `service_role key`: Chave privada exclusiva para rotas backend/servidor

### 1.2 Executando o Banco de Dados
Acesse o **SQL Editor** do Supabase e execute o conteúdo do arquivo `docs/02_BANCO_DE_DADOS_E_RLS_SUPABASE.md`. O script criará todas as tabelas, índices e regras de isolamento RLS.

### 1.3 Configuração dos Buckets de Storage
1. No menu lateral do Supabase, acesse **Storage**.
2. Crie dois buckets públicos:
   - `product-images`: Para armazenar fotos e especificações dos produtos (tamanho máximo de 10 MB, tipos mime `image/jpeg`, `image/png`, `image/webp`).
   - `brand-assets`: Para logos, banners e identidades visuais dos lojistas.
3. Configure a política de acesso dos buckets para **Public Read** para que as imagens sejam servidas pela CDN global do Supabase.

---

## 2. Deploy no Netlify

O Netlify é a plataforma recomendada para o frontend devido ao suporte nativo a Single Page Applications (SPA), Edge Functions e certificados SSL automáticos.

### 2.1 Arquivo `netlify.toml`
Crie o arquivo `netlify.toml` na raiz do projeto com o seguinte conteúdo:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "20"
```

### 2.2 Variáveis de Ambiente no Netlify
No painel do Netlify, vá em **Site Configuration > Environment variables** e adicione:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key-aqui
RESEND_API_KEY=re_123456789
```

---

## 3. Configuração de DNS e Domínios Personalizados

### 3.1 Subdomínios Wildcard (Para Multi-Tenancy Dinâmico)
Para permitir que qualquer cliente acesse sua loja via `nome-da-loja.seusaas.com.br`:
1. No provedor de DNS (ex: Cloudflare, Registro.br, GoDaddy), crie um registro CNAME:
   - **Tipo**: `CNAME`
   - **Nome**: `*` (asterisco)
   - **Destino**: `seu-site.netlify.app`

### 3.2 Domínio Próprio do Lojista (Whitelabel Total)
Quando um cliente quiser usar o próprio domínio (ex: `catalogo.mcdistribuicao.com.br`):
1. O cliente cria um registro CNAME apontando para o seu SaaS:
   - **Host**: `catalogo`
   - **Tipo**: `CNAME`
   - **Destino**: `seu-site.netlify.app`
2. No painel administrativo do seu SaaS, registre o domínio no campo `customDomain` da empresa. O sistema reconhecerá automaticamente o host da requisição e renderizará a loja correta.

---

## 4. Deploy Alternativo em Docker / Cloud Run

Caso prefira hospedar a aplicação em container Docker no **Google Cloud Run**:

### 4.1 Dockerfile de Produção
```dockerfile
# Etapa 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etapa 2: Servidor de Alta Performance Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 4.2 Arquivo `nginx.conf`
```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
```
