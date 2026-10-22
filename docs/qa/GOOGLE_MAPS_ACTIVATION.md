# Google Maps — preparação e bloqueios de ativação

## Escopo e estado

Usuário escolheu Google Maps e distância rodoviária automática A=loja/B=cliente; tarifas diferentes para Moto e Carro/Caminhão. Substitui proposta Geoapify e aprovação inicial de distância manual. Zero cobranças indesejadas é uma restrição de ativação, não uma garantia que alerta de faturamento sozinho ofereça.

Implementado como preparação, NÃO integrado nem publicado: adapter servidor computeGoogleRoadDistance, cálculo em centavos, gerador Maps URLs e componente de link externo. Testes sintéticos PASS, sem chamadas reais. O adapter exige autorização de ativação e reserva de quota; não existe ainda implementação persistente dessa reserva nem endpoint/browser integrado. Não usar o callback com retorno constante true em produção.

## Contrato técnico proposto

- Compute Routes REST: origin/destination address, DRIVE, TRAFFIC_UNAWARE, sem alternativas/waypoints/tráfego/recursos Enterprise; field mask somente routes.distanceMeters. Não chamar Geocoding/Places separadamente.
- Tarifa selecionada de configuração autorizada do tenant no backend, nunca recebida como verdade comercial do cliente. Distância em metros multiplicada por centavos/km /1000, arredondamento final em centavos.
- HTTP referrer não é restrição adequada da chave REST usada no servidor. Chave secreta restrita a Routes API; IP de saída se estável/disponível, caso contrário arquitetura segura deve ser definida antes de ativar. Não inventar IP fixo para Supabase Edge. CORS/origin da aplicação não substitui autenticação e quotas.
- Quota diária Google solicitada <=300, verificar nome, dimensão e valor efetivamente aplicado no projeto; quota por minuto não equivale a diária. Controle persistente atômico adicional de 300 tentativas/dia global, incluindo falhas, e teto mensal conservador, com timezone do reset verificado. Sem retries automáticos ou fallback pago. Falha do contador impede chamada.
- Free usage cap atual Compute Routes Essentials=10.000/mês; 300×31=9.300. Isso depende de chamadas realmente Essentials e de todo consumo compartilhado por conta/SKU. Confirmar outras chaves/projetos e regras de agregação antes de declarar proteção de custo.
- Moto TWO_WHEELER e recursos de veículos grandes acionam Enterprise; não ativar silenciosamente. DRIVE fornece rota de carro, não garante trajeto legal de caminhão ou específico de moto. Usuário precisa decidir se aceita a mesma rota básica com tarifas diferentes ou requer perfis distintos, incompatíveis com o pressuposto Essentials.
- Maps URLs /maps/dir/?api=1 com origin/destination/travelmode=driving: link sem API key, aberto apenas por clique em nova aba; não consome a consulta Compute Routes. O Maps pode recalcular o trajeto, não prometer identidade com o cálculo salvo. Não abrir automaticamente durante QA nem expor endereço real em evidência.

## Console e dependências

Inspeção autenticada mostrou projeto selecionado MEDICAOAGUA, ID gen-lang-client-0361137673, e etapa de concluir configuração da conta Maps. Não é evidência de que esse seja o projeto autorizado do Catálogo. Nada ativado/modificado, billing/key/quota/alerta NÃO configurados. Solicitados ID correto e e-mail de alerta.

Antes de ativação: identificar projeto correto/domínio/API e IP/backend; verificar billing e consumo existente; salvar quota diária e read-back; orçamento e destinatário de alerta; confirmar escopo de novos Spend Cap Budgets caso disponível (não presumir cobertura Maps ou zero atraso); restringir chave; testar negativas e limite com fixtures locais; só então considerar habilitação real. Nenhuma vinculação de cartão, assinatura ou provisão de custo autorizada por inferência.

Fontes oficiais consultadas:
- https://developers.google.com/maps/documentation/routes/usage-and-billing
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/api-security-best-practices
- https://developers.google.com/maps/documentation/routes/compute_route_directions
- https://developers.google.com/maps/documentation/urls/get-started
- https://docs.cloud.google.com/billing/docs/how-to/budgets
- https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps

## Atualizacao autorizada em 2026-10-11
Usuario informou projeto catalogo-511302 e aceitou mesma rota basica DRIVE para Moto e Carro/Caminhao, variando somente tarifa/km. Nao usar TWO_WHEELER nem recursos de veiculos grandes. Email de alerta solicitado separadamente; nao inferir endereco da conta como destinatario. Inspecao de quotas iniciada no projeto correto; configuracao ainda nao confirmada.

Read-back autenticado 2026-10-11: projeto Catalogo catalogo-511302, Routes API habilitada (botao Desativar). Quota Directions - ComputeRoutes per request quota per day=250, uso atual 0, ajustavel Sim; quota por minuto=300. Matrix per-element/day=250, minuto=300. Preservada cota diaria250 por ser menor que maximo300 solicitado. Nao confundir minuto300 com dia250. Nenhuma cota aumentada, nenhuma consulta real enviada. Falha inicial de locator seguida de snapshot confirmou selecao Routes concluida; sem repetir mutacao. Chave, billing e alertas ainda nao verificados/configurados.

## Console - alteracoes verificadas em 2026-10-11
Usuario autorizou destinatario jobmcc@hotmail.com. Canal Monitoring Catalogo - alertas de faturamento criado; tabela confirma email. Orcamento Catalogo - monitoramento de cobrancas salvo, ID118ec1b9-fdaa-4a0f-b00d-90ad4ca7937b, mensal R, avisos reais50/90/100%, canal selecionado; notificacao de criacao e tabela confirmadas. Escopo CONTA de faturamento (atualmente unico projeto Catalogo), todos servicos; nao alegar filtro exclusivo de projeto ou spend cap. Administradores de faturamento tambem recebem alertas. Entrega/recebimento do email nao testado. Sem Pub/Sub ou recursos contratados.
Chave existente Maps Platform API Key estava autorizada para32APIs sem restricao de aplicativo. Restricao reduzida a Routes API e confirmada na tabela de credenciais; valor da chave nao revelado/copiado. Restricao de aplicativo ainda ausente, dependencia de arquitetura/proxy/IP confiavel permanece. Sem uso real, sem configuracao de segredo no backend. Quota/day250 preservada. Conta billing ja paga antes desta execucao; nenhuma vinculacao de cartao feita. Alerta NAO e bloqueio de gastos. Ainda nao autorizar ativacao nem declarar riscozero.

## Contador persistente local
Migration20261011032224_google_routes_usage_limits.sql criada pela CLI e aplicada exclusivamente ao container local corsys-pr6-local-qa. Contador global atomico serializado por advisory xact lock:250tentativas/dia e7500/mes, America/Los_Angeles. Sem devolucao de tentativas falhas. RPC executavel somente service_role; tabela inacessivel inclusive para reset pelo service_role. SQL05 PASS:primeiras250 aceitas,251negada,teto mensalnegado,anon/auth negados,resetservice negado; fixtures rollback. Concorrencia entre conexoes nao executada, timezone de quotaGoogle ainda requer confirmacao. Endpoint eUI nao integrados; adapter ja exige reserva mas callback persistente nao conectado. Nao confundir PASSdoSQL com E2Edaentrega. Chave Google nao usada; protecao de aplicativo/origem de saida e compartilhamento billing seguem bloqueios de ativacao.

## Validacao local e impedimento de protecao (2026-10-11)
Supabase documentacao oficial confirma ausencia de egressIPestatico paraEdgeFunctions; IPallowlist nao funciona permanentemente semproxy/arquiteturaadicional. HTTPreferrer nao substitui restricaoIPdeRESTbackend. OAuth aparece em documentoAutomotive paraComputeRoutes, mas habilitacao geral/IAM/fluxo deproducao nesteprojeto nao verificados; nao prometercompatibilidade comoalternativa concluida.
Runtime local reiniciado sessao16937, qa-local.env ROUTING_ALLOWED_ORIGINS127.0.0.1:5174 eGOOGLE_ROUTES_ENABLEDfalse; configfuncverify_jwtfalse. POSTlocal503indisponivelcomprovado. UIreal: adicionarproduto30, avancar, Moto, preencher6campos ficticios, calcular => alertaindisponivel,total30preservado,semquilometragem/linkdeconsultaficticios. Camposvaziosagora impedemconsulta; labelsinternos uber_moto/uber_carro corrigidosnocatalogo; lintPASS. Nao marcar fluxoGooglebem-sucedido:naohachaveinstalada/chamadareal. Semcontratarproxy ouafrouxarrestricao porinferência. Para ativar comchavesomenteemsegredo semIPrestrito, necessarioaceiteexplicito daalteracao deprotecao eimpossibilidadedegarantir riscozero exigido. Alternativa manterdesativado/avaliarbackendautenticacaoverificada.
Fonte:https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0
FonteOAuth:https://developers.google.com/maps/documentation/routes/auto/oauth-token?hl=pt-br

## Validação real local — 2026-10-11

O usuário aprovou prosseguir após receber a explicação sobre o risco residual da chave sem restrição por IP. Restrição à Routes API confirmada novamente no Console. Chave instalada exclusivamente no arquivo privado de ambiente do servidor local, fora do checkout Git; valor não registrado nesta documentação nem exposto no navegador.

Quatro consultas reais passaram pelo endpoint local e foram contabilizadas nos dois contadores privados (dia: 4; mês: 4). Endereços públicos de teste: MASP, Avenida Paulista 1578, e Praça da Sé 1, São Paulo. Retorno Google: 4143 metros. Moto a 180 centavos/km: 746 centavos; Carro/Caminhão a 250 centavos/km: 1036 centavos. Ambas as modalidades usam DRIVE básico.

Na interface: distância 4,14 km; Moto R$ 7,46; Carro/Caminhão R$ 10,36. Trocar modalidade removeu o resultado anterior. Link universal Maps gerado com origem/destino e sem chave. Total do pedido continuou R$ 30,00, com frete a combinar; nenhum pedido foi enviado. Evidência visual: qa-google-route-success.png na raiz do workspace.

Requisições com origem não permitida, endereço incompleto e consentimento ausente foram rejeitadas (403/400/400). Verificação completa `check` passou, incluindo testes existentes e novos testes de entrega/rotas. Testes sintéticos não substituem o registro separado das quatro consultas reais.

Ativação limitada ao ambiente local. Produção não recebeu chave, migrations nem deploy. Cota Google anteriormente verificada: 250/dia; limite local: 250/dia e 7500/mês. O limite mensal local não protege chamadas realizadas diretamente com uma chave vazada; alertas de faturamento não bloqueiam gastos. Sem garantia de custo zero. Link Maps foi inspecionado; a navegação externa não foi testada. Matriz B2B completa e CI do novo trabalho continuam pendentes.

## Reauditoria da chave e controles adicionais — 2026-10-11

Escopo autorizado: adapter Google, endpoint público estimate-delivery, limites PostgreSQL, arquivo secreto local, código/frontend compilado e logs locais. Produção, IAM/2FA da conta Google e histórico completo Git não avaliados nesta rodada. Nenhuma nova chamada Google foi necessária.

Achado confirmado: uma pessoa pode falsificar Origin fora do navegador e esgotar a cota global; CORS não autentica. Mitigação aplicada: reserva serializada também limita a 10 tentativas por janela de 60 segundos, mantendo 250/dia e 7500/mês. Não elimina abuso lento/distribuído nem protege uso direto de chave vazada. A janela permite rajadas na fronteira entre janelas; não é limite móvel. Uso legítimo acima do limite recebe indisponibilidade temporária, sem fallback pago.

Achado confirmado: arquivo privado .env herdava permissão de leitura do grupo local CodexSandboxUsers. Remediação aplicada e lida novamente: herança removida e três identidades explícitas — usuário atual, SYSTEM e Administradores. Administradores e processos executados como o usuário ainda podem acessar o segredo. Arquivo permanece fora do checkout e deve ser excluído de backups/exportações compartilhadas. Não houve criptografia adicional do arquivo nem avaliação de BitLocker.

Prevenção adicional: check inclui test-google-secret-boundary.ts. Rejeita padrões de chave Google em fontes/artefatos e referência à variável/header server-only em frontend/dist. Mensagens não imprimem valores de credenciais. Comparação exata com a chave real em 18 logs/artefatos locais passou, inclusive arquivos de log abertos (leitura compartilhada). Isso não certifica outros logs, backups, histórico remoto ou serviços externos.

Endpoint mantém destino Google fixo, HTTPS, redirects recusados, timeout 8s, sem retries automáticos, resposta de erro sanitizada e corpo máximo 4096 bytes. JSON malformado agora retorna 400. Chave enviada em cabeçalho, nunca em URL; nenhum console/log do endpoint registra chave ou endereço. Esses controles foram inspecionados; redirects/timeout não foram ensaiados contra Google nesta rodada.

VERIFIED: testes SQL de cotas diária/mensal e isolamento; SQL de rajada (10 permitidas, 11 bloqueada, janela expirada libera, serviço não reseta); check completo (tipos/build/regressões/rotas/fronteira do segredo). SQL transacional com rollback, sem consumo Google. Migration nova aplicada somente no banco local. Não foi feito teste de carga ou concorrência em conexões independentes.

Risco residual: chave sem restrição IP pode ser reutilizada por quem a obtiver. Restrição Routes não limita SKU; alertas não bloqueiam cobrança. IP de saída fixo/identidade OAuth, proteção adicional de bot e revisão de IAM/2FA devem ser avaliados antes da ativação em produção, sem criar infraestrutura paga. Não foi observado vazamento nos arquivos examinados; não é garantia absoluta.

Fonte oficial consultada: https://developers.google.com/maps/api-security-best-practices . Rollback: reverter migration de rajada para a função anterior preservando cotas, remover teste de scanner se necessário; restauração de ACL requer decisão explícita e não é recomendada. Documentos anteriores permanecem registro histórico; este marco descreve controles atuais.