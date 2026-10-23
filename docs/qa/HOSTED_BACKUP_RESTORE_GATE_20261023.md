# Gate de recuperação Supabase Hosted — Frete V1 (23/10/2026)

**Status:** PREPARADO PARA EXECUÇÃO PRIVADA PELO RESPONSÁVEL. **NOT EVALUATED** para backup real, restauração real de Auth/ACL e arquivos físicos Storage. Este documento é plano operacional, não autoriza DDL, exportação de dados privados para terceiros, mudança de configuração, merge ou deploy.

## 1. Escopo e fonte de verdade (consulta somente leitura)

- Projeto: `Corsys_Catalogo` / `vlpwtdqqnecdvccxyodp`, região `sa-east-1`, status `ACTIVE_HEALTHY`.
- Organização: plano **Free**; PostgreSQL servidor 17.6. Histórico Hosted: **20 migrations até `000020`**; `000023`, `000024` e as duas Google 20261011 não aplicadas.
- Inventário em 23/10/2026 (somente contagens, sem payload de pessoas/objetos): `public.tenants=1`, `public.products=520`, `public.orders=6`, `auth.users=2`, `public.wholesale_customers=0`, `storage.objects=105`, `storage.buckets=3`.
- Storage: `product-media` **100 objetos, público**, metadados de tamanho ~9.698.226 bytes; `order-documents` **5 objetos, privado**, metadados de tamanho ~14.044 bytes; `tenant-assets` **0 objetos, público**. Tamanhos provêm de metadados e não provam integridade física. Volume agregado estimado 9.712.270 bytes.
- Evidência do SQL **sintético**, não Hosted: GitHub Actions `39998260267`, commit `ec679f3312dc6aca06499330c2cb6bd6db279d0a`, `STAGING-000023-000024 PASS`. Não confundir com restauração do banco atual de produção.
- Backups diários automáticos não disponíveis em plano Free. Não foi observada nem realizada exportação e restauração recente do ambiente real.

## 2. Isolamento e limites obrigatórios

1. Apenas o operador autorizado, em máquina **sob seu controle**, acessa as credenciais. Não colocar URI com senha, URL assinada, token, `service_role`, dump, inventário com nomes de arquivos ou PDF de pedidos no GitHub, CI/CD, chat ou Google AI Studio.
2. Antes de iniciar exportação, aprovar local privado criptografado, acesso restrito, retenção e responsável. Usar `umask 077` e desligar shell tracing. Usar conexão de leitura/exportação permitida; operações de exportação não aplicam migrations.
3. Criar **destino de restauração temporário totalmente separado**, com PostgreSQL e componentes Supabase compatíveis (preferir PG 17), sem link para produção. Revisar URL completa do destino e preflight antes de qualquer `psql` de restauração.
4. **Proibido** durante esta etapa: `supabase db push`, `supabase db reset --linked`, `supabase migration up --linked`, `supabase migration repair`, `supabase functions deploy`, importação de backup para Hosted, `supabase link` desnecessário, modificação de chave/API Google, merge ou Cloudflare deploy.
5. Exportar e restaurar apenas em ambiente privado; **não utilizar GitHub Actions** para carregar cópia do banco real ou PDFs privados.

## 3. Backup lógico do PostgreSQL — execução futura supervisionada

Documentação oficial:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
- https://supabase.com/docs/reference/cli/supabase-db-dump

Pré-requisitos no computador do responsável: Docker executando, Supabase CLI, `psql` e local de backup criptografado. Obter a URI correta em **Supabase Dashboard > Connect** (session pooler ou conexão direta). O operador mantém a URI em uma variável efêmera sem colocá-la em histórico ou capturas de tela. Exemplos abaixo são **somente procedimento futuro**, não executados neste checkpoint.

```bash
# Operador local — não executar em GitHub Actions nem copiar segredos para chat.
umask 077
set +x
mkdir -p "$HOME/corsys-private-recovery"
chmod 700 "$HOME/corsys-private-recovery"
cd "$HOME/corsys-private-recovery"
# Definir SOURCE_DB_URL de modo privado (não escrever URL/senha em texto no comando).
test -n "${SOURCE_DB_URL:-}" || { echo "Fonte não configurada"; exit 1; }
supabase db dump --db-url "$SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$SOURCE_DB_URL" -f data.sql --use-copy --data-only
test -s roles.sql && test -s schema.sql && test -s data.sql
sha256sum roles.sql schema.sql data.sql > database-sha256.txt
unset SOURCE_DB_URL
```

Verificações **antes de declarar backup disponível**:
- Conferir códigos de saída 0, arquivos não vazios e checksums; preservar cópia off-site criptografada com controle de acesso e capacidade de descriptografar.
- O dump CLI tem filtros Supabase, inclusive schemas administrados. **Não assumir que `auth.users`, customizações Auth/Storage, grants especiais ou tracking das migrations foram capturados apenas pela existência de `data.sql`.** A prova é restauração, contagens e inspeção de objetos/roles conforme a documentação oficial.
- Quando necessário, exportar separadamente histórico `supabase_migrations` e customizações de schemas gerenciados, após planejamento explícito para evitar conflito com bootstrap da instância destino. **Não inserir manualmente histórico sem validar semântica.**
- Nenhum dump por `pg_dump` é comprovadamente recuperação de todo o Supabase: configurações Auth, Edge, Realtime, emails, domínios, integrações, credenciais e arquivos físicos exigem verificação separada.

## 4. Backup dos objetos físicos do Storage — execução futura privada

Referências:
- https://supabase.com/docs/guides/storage/management/download-objects
- https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

**Objetivo de completude:** guardar bytes, caminho lógico, bucket, tamanho e checksum SHA-256 para cada um dos **105 objetos**, cobrindo **100 `product-media` + 5 `order-documents`** e o bucket vazio `tenant-assets`. Os caminhos reais, hashes de PDFs e downloads devem permanecer **privados**.

- Exportar com cliente autenticado de Storage/S3 em máquina confiável; para muitos objetos, o Supabase documenta uso de `rclone`, `Cyberduck` ou migração por script. A configuração de S3 e emissão de novas credenciais **não estão autorizadas por este documento**: obter aprovação específica caso necessárias. Alternativamente, utilizar a API Storage com credencial server-side mantida só na máquina do operador.
- Salvar manifest privado por bucket e comparar a enumeração final à contagem SQL de origem, registrando mudanças concorrentes durante a cópia.
- Validar leitura local de amostra de mídia **e todos os cinco PDFs privados**, checar hashes e tamanho/consistência; não expor dados de compradores nos relatórios.
- A restauração a um novo Supabase exige transferência via API Storage/S3 com metadados coerentes; **não** simplesmente copiar bytes para pasta interna de self-hosted (estrutura física diferente).
- Testar acessos em ambiente restaurado: documento privado não acessível anonimamente; acesso autenticado autorizado e bloqueio a usuário de outro tenant.

## 5. Restauração e homologação em ambiente separado

1. Provisionar instância descartável privada e compatível; confirmar identificadores/host antes de restaurar. Se a instância nova tiver custo, solicitar autorização prévia. Não restaurar sobre `vlpwtdqqnecdvccxyodp`.
2. Aplicar procedimento oficial para roles, schema e data em destino **isolado**, com `ON_ERROR_STOP=1` e transação onde aplicável. Avaliar compatibilidade de PG 17, extensões, `auth` e `storage`. Não editar dados reais do dump sem registrar razão e efeitos.
3. Verificar contagens de tenants/produtos/pedidos/Auth/buckets/objetos, somas/digests proporcionais, FKs, RLS, ACL, ownership de funções `SECURITY DEFINER`, integridade do `private`, consentimentos e isolamento por tenant. Registrar apenas agregados sem PII.
4. Confirmar as cinco cópias físicas privadas acessíveis pelo mecanismo autorizado, e que visitante anon não tem acesso. Conferir checksums de todas as cópias; não expor PDFs/credenciais no log.
5. Medir **RPO** (janela de perda de dados entre cópia e referência do ambiente) e **RTO** (tempo para recuperar acesso operacional); responsável deve formalizar limites aceitos antes da liberação.
6. Documentar integração de OAuth, SMTP, JWT, Edge Functions, Storage, Realtime, Cloudflare, DNS e chaves server-side; elas **não** estarão necessariamente reconstituídas pelo SQL. Validar como restaurar/reconfigurar sem revelar seus valores.
7. Registrar o resultado **PASS/FAIL/NOT EVALUATED** por item. Caso roles/Auth/Storage ou dados não retornem íntegros, marcar **BLOQUEADO** sem autorizar migration Hosted.
8. Destruir somente o destino descartável **depois** de validar a evidência. Não destruir a cópia criptografada do backup.

## 6. Critério de liberação (gate)

- [ ] Backup `roles.sql` + `schema.sql` + `data.sql` realmente criado, cifrado, com checksums e cópia privada de contingência.
- [ ] Todos os **105 objetos físicos** copiados e validados contra inventário/hash; cinco PDFs privados cobertos e sem vazamento.
- [ ] Banco restaurado em destino independente com schema, roles, RLS/ACL, auth.users e pedidos conferidos.
- [ ] Testes de isolamento de compradores/tenants e permissões de Storage privados aprovados.
- [ ] RPO e RTO medidos e limites formalmente aceitos; processo de recuperação repetível pelo responsável.
- [ ] Configurações não-DB (Auth/Realtime/Storage/Edge/Cloudflare) documentadas, falhas e limitações classificadas.
- [ ] Autorização explícita **posterior e distinta** para migrations Hosted `000023` e `000024`, mais migrations Google, ativação de cobrança/segredos, merge e deploy.

**Resultado atual:** PREPARADO / NÃO EXECUTADO. O gate não é satisfeito por `Quality` ou por ensaio de banco sintético. Até conclusão e aprovação, produção intocada.

## 7. Registro de execução (preencher somente após operações reais; SEM segredos)

- Operador responsável: [pendente]
- Janela/data da exportação: [pendente]
- Local de backup privado (descrição genérica, sem URI): [pendente]
- Schema/roles/data exportados e checksums verificáveis: [pendente]
- Storage: arquivos por bucket, total e checksums: [pendente]
- Ambiente isolado usado para restauração (identificador não sensível): [pendente]
- Contagens de negócio/Auth comparadas: [pendente]
- Permissões RLS e privado: [pendente]
- RPO aceito / medido: [pendente]
- RTO aceito / medido: [pendente]
- Status final: **NOT EVALUATED**
