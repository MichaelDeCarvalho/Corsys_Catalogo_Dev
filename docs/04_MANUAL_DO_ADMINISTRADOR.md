# 📋 04. Manual de Operações do Administrador

Este manual detalha o passo a passo operacional para os administradores da **MC Distribuição** ou de qualquer empresa que utilize a plataforma OmniCatálogo.

---

## 1. Acessando os Modos de Visão

No topo da aplicação, a barra de navegação oferece acesso rápido aos diferentes módulos:

- **🏪 Painel da Loja (Tenant Admin)**: Gestão operacional da empresa ativa.
- **🛒 Catálogo Público (Storefront)**: A visão do cliente final ou comprador de atacado.
- **🛡️ Painel Master (SuperAdmin)**: Gestão da plataforma SaaS para criação de novos lojistas.
- **💻 Guia de Revenda & SQL**: Documentação técnica e scripts de infraestrutura.

---

## 2. Gestão de Produtos

Acesse a aba **Produtos** dentro do **Painel da Loja**:

### 2.1 Cadastrando um Novo Produto
1. Clique no botão **"+ Novo Produto"**.
2. Preencha os campos obrigatórios:
   - **Nome do Produto**: Título claro e objetivo (ex: `BROCA HSS AÇO RÁPIDO - #9,5X125MM`).
   - **Código / SKU**: Código único de referência (ex: `BR090`).
   - **Categoria e Subcategoria**: Selecione a classificação correta para facilitar a busca do cliente.
   - **Preço de Tabela (R$)**: Preço de venda unitário padrão.
   - **Preço de Atacado (R$)**: Preço promocional para compras volumosas ou clientes B2B.
   - **Estoque**: Quantidade física disponível para expedição imediata.
   - **Unidade de Medida**: Escolha entre `un` (unidade), `cx` (caixa), `fd` (fardo) ou `kit`.
   - **Regras de Imagem**: Envie fotos em JPG, PNG ou WebP. O sistema possui tratamento inteligente de imagens:
     - **Enquadramento Seguro**: A imagem é tratada com `object-fit: contain` e fundo limpo para garantir que **nenhuma ponta ou detalhe técnico seja cortado** nas vitrines do catálogo ou no modal de zoom.

### 2.2 Configuração de Escala de Atacado (Wholesale Tiers)
No formulário do produto, você pode configurar faixas progressivas de desconto:
- **Faixa 1**: Acima de 5 unidades -> 5% de desconto automático.
- **Faixa 2**: Acima de 20 unidades -> 12% de desconto automático.
- **Faixa 3**: Acima de 50 unidades -> Preço de distribuidor.

---

## 3. Fluxo e Gestão de Pedidos

Acesse a aba **Pedidos** para gerenciar o pipeline de faturamento e separação:

### 3.1 Ciclo de Vida de um Pedido
```
[1. Pendente] ──► [2. Aprovado / PIX Pago] ──► [3. Em Separação] ──► [4. Despachado] ──► [5. Entregue]
```

- **Pendente**: O cliente enviou a cotação pelo catálogo ou WhatsApp. Aguardando conferência ou comprovante de pagamento.
- **Aprovado**: Pagamento via PIX confirmado ou crédito faturado liberado. O estoque é reservado.
- **Em Separação**: Equipe de expedição imprimiu o espelho do pedido e está embalando os itens no galpão.
- **Despachado**: Mercadoria entregue à transportadora ou colocada no veículo de entrega com código de rastreamento.
- **Entregue**: Pedido concluído com sucesso.

### 3.2 Ações Rápidas de Pedido
- **Conversar no WhatsApp**: Abre a conversa diretamente com o comprador já com o número do pedido.
- **Ver Itens e Medidas**: Exibe a lista discriminada de produtos, SKUs e quantidades solicitadas.
- **Alterar Status**: Atualiza instantaneamente a linha do tempo do pedido.

---

## 4. Gestão da Equipe de Vendas (Representantes)

Acesse a aba **Equipe**:
1. Cadastre seus vendedores e representantes externos com nome, e-mail, telefone e código de vendedor (ex: `CARLOS10`, `MICHAEL20`).
2. Defina a **Taxa de Comissão** (ex: 3.5% ou 5.0%).
3. Cada vendedor recebe um link próprio para enviar aos clientes:
   - Exemplo: `https://mcdistribuicao.omnicatalogo.com.br/?ref=CARLOS10`
4. Todos os pedidos realizados por esse link são automaticamente associados ao vendedor, permitindo auditar o volume vendido e calcular a comissão mensal sem erros.

---

## 5. Personalização e Configurações da Empresa

Acesse a aba **Configurações da Loja**:
- **Identidade da Marca**: Razão Social, Nome Fantasia, CNPJ e Segmento.
- **Cores Oficiais**: Seletor visual de cor primária (botões e destaque) e cor secundária.
- **Atendimento**: Telefone e WhatsApp comercial onde os pedidos fechados serão recebidos.
- **Dados Financeiros**: Chave PIX (CNPJ, E-mail, Celular ou Aleatória) que aparece na tela de confirmação de pedido.
- **Políticas de Frete**:
  - Habilitar Retirada no Galpão.
  - Habilitar Envio por Transportadora / Carreto.
  - Definir Valor Fixo de Frete (ex: R$ 35,00) e **Valor Mínimo para Frete Grátis** (ex: R$ 1.000,00).
