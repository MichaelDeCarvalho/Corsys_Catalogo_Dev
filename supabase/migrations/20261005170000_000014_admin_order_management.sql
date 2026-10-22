-- =============================================================================
-- CORSYS CATÁLOGO - MIGRATION 000014: ADMIN ORDER MANAGEMENT V2
-- Data: 2026-10-05
-- Arquitetura: Status Server-Side + Controle de Estoque + RPC Interna Segura
-- =============================================================================
-- Princípios e Diretrizes:
-- 1. Forward-only: Migrations 000001 a 000013 permanecem aplicadas e congeladas.
-- 2. Menor Privilégio: manage_order_status_internal é restrita exclusivamente a service_role.
-- 3. Identidade Segura: O ator executor (p_actor_user_id) é validado server-side via Edge Function.
-- 4. Trava Pessimista e Ordenada: Locks FOR UPDATE em produtos ordenados por UUID evitam deadlocks.
-- 5. Atomicidade e Idempotência: Operações transacionais estritas com rollback completo em falhas.
-- 6. Minimização de PII: Retorno da RPC contém apenas id, order_number, status e updated_at.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. REAFIRMAR BLOQUEIO DEFENSIVO DA RPC LEGADA
-- -----------------------------------------------------------------------------
-- Reafirma que a função legada public.manage_order_status(uuid, text) permanece
-- sem privilégio de execução para qualquer papel de API (PUBLIC, anon, authenticated, service_role).
REVOKE ALL ON FUNCTION public.manage_order_status(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.manage_order_status(UUID, TEXT) IS 'DEPRECATED/REVOKED: RPC legada sem execução concedida a nenhum papel. Substituída por manage_order_status_internal via gateway.';

-- -----------------------------------------------------------------------------
-- 2. CRIAR RPC INTERNA: public.manage_order_status_internal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_order_status_internal(
    p_order_id UUID,
    p_new_status TEXT,
    p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_is_platform_admin BOOLEAN;
    v_item RECORD;
    v_prod_stock INTEGER;
    v_affected_rows INTEGER;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- 2.1 Validação Fail-Closed de Parâmetros
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'Identificador de pedido é obrigatório.' USING ERRCODE = '22000';
    END IF;

    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'Identificador do operador executor é obrigatório.' USING ERRCODE = '22000';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('pending', 'approved', 'preparing', 'dispatched', 'delivered', 'cancelled') THEN
        RAISE EXCEPTION 'Status de pedido inválido: %', p_new_status USING ERRCODE = '22000';
    END IF;

    -- 2.2 Lock pessimista na linha do pedido
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
    END IF;

    -- 2.3 Validação Server-Side de Autorização do Ator
    -- Permitido exclusivamente: platform_admin OU tenant_users (tenant_admin / stock_manager) do MESMO tenant.
    -- sales_rep e operadores cross-tenant são expressamente rejeitados.
    v_is_platform_admin := EXISTS (
        SELECT 1 FROM public.platform_admins WHERE id = p_actor_user_id
    );

    IF NOT v_is_platform_admin THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.tenant_users
            WHERE tenant_id = v_order.tenant_id
              AND id = p_actor_user_id
              AND active = true
              AND role::text IN ('tenant_admin', 'stock_manager')
        ) THEN
            RAISE EXCEPTION 'Acesso não autorizado para gerenciar pedidos deste tenant.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 2.4 Estados terminais: delivered e cancelled são irreversíveis
    IF v_order.status IN ('delivered', 'cancelled') THEN
        RAISE EXCEPTION 'Pedido já está em estado terminal (%) e não permite transição.', v_order.status USING ERRCODE = '55000';
    END IF;

    -- 2.5 Idempotência segura se o status já for o desejado
    IF v_order.status = p_new_status THEN
        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', v_order.status,
            'updated_at', v_order.updated_at
        );
    END IF;

    -- 2.6 Máquina de Estados e Controle Transacional de Estoque
    IF v_order.status = 'pending' AND p_new_status = 'approved' THEN
        -- PENDING -> APPROVED: Adquirir locks pessimistas ordenados por UUID e decrementar estoque
        FOR v_item IN
            SELECT (elem->>'productId')::uuid AS prod_id,
                   (elem->>'quantity')::integer AS qty
            FROM jsonb_array_elements(v_order.items) elem
            ORDER BY (elem->>'productId')::uuid ASC
        LOOP
            IF v_item.qty IS NULL OR v_item.qty < 1 THEN
                RAISE EXCEPTION 'Quantidade de item inválida (%) no pedido.', v_item.qty USING ERRCODE = '22000';
            END IF;

            SELECT p.stock INTO v_prod_stock
            FROM public.products p
            WHERE p.id = v_item.prod_id
              AND p.tenant_id = v_order.tenant_id
              AND p.active = true
              AND p.deleted_at IS NULL
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Produto % indisponível, inativo ou excluído durante a aprovação.', v_item.prod_id USING ERRCODE = 'P0002';
            END IF;

            IF v_prod_stock < v_item.qty THEN
                RAISE EXCEPTION 'Estoque insuficiente para aprovação do item (Disponível: %, Solicitado: %).',
                    v_prod_stock, v_item.qty USING ERRCODE = '55P03';
            END IF;

            UPDATE public.products
            SET stock = stock - v_item.qty,
                updated_at = now()
            WHERE id = v_item.prod_id AND tenant_id = v_order.tenant_id;

            GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
            IF v_affected_rows <> 1 THEN
                RAISE EXCEPTION 'Falha ao debitar estoque do produto % (linhas afetadas: %).', v_item.prod_id, v_affected_rows USING ERRCODE = '55000';
            END IF;
        END LOOP;

        UPDATE public.orders
        SET status = 'approved',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'approved',
            'updated_at', v_updated_at
        );

    ELSIF v_order.status = 'pending' AND p_new_status = 'cancelled' THEN
        -- PENDING -> CANCELLED: Estoque nunca foi debitado, apenas atualiza status
        UPDATE public.orders
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'cancelled',
            'updated_at', v_updated_at
        );

    ELSIF v_order.status = 'approved' AND p_new_status = 'preparing' THEN
        -- APPROVED -> PREPARING: Estoque já debitado, apenas atualiza status
        UPDATE public.orders
        SET status = 'preparing',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'preparing',
            'updated_at', v_updated_at
        );

    ELSIF (v_order.status = 'approved' OR v_order.status = 'preparing') AND p_new_status = 'cancelled' THEN
        -- APPROVED/PREPARING -> CANCELLED: Restaurar estoque exatamente uma vez
        FOR v_item IN
            SELECT (elem->>'productId')::uuid AS prod_id,
                   (elem->>'quantity')::integer AS qty
            FROM jsonb_array_elements(v_order.items) elem
            ORDER BY (elem->>'productId')::uuid ASC
        LOOP
            IF v_item.qty IS NULL OR v_item.qty < 1 THEN
                RAISE EXCEPTION 'Quantidade de item inválida (%) no pedido.', v_item.qty USING ERRCODE = '22000';
            END IF;

            PERFORM 1
            FROM public.products p
            WHERE p.id = v_item.prod_id AND p.tenant_id = v_order.tenant_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Produto % não encontrado para o tenant durante o cancelamento.', v_item.prod_id USING ERRCODE = 'P0002';
            END IF;

            UPDATE public.products
            SET stock = stock + v_item.qty,
                updated_at = now()
            WHERE id = v_item.prod_id AND tenant_id = v_order.tenant_id;

            GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
            IF v_affected_rows <> 1 THEN
                RAISE EXCEPTION 'Falha ao restaurar estoque do produto % (linhas afetadas: %).', v_item.prod_id, v_affected_rows USING ERRCODE = '55000';
            END IF;
        END LOOP;

        UPDATE public.orders
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'cancelled',
            'updated_at', v_updated_at
        );

    ELSIF v_order.status = 'preparing' AND p_new_status = 'dispatched' THEN
        -- PREPARING -> DISPATCHED: Não altera estoque
        UPDATE public.orders
        SET status = 'dispatched',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'dispatched',
            'updated_at', v_updated_at
        );

    ELSIF v_order.status = 'dispatched' AND p_new_status = 'delivered' THEN
        -- DISPATCHED -> DELIVERED: Terminal
        UPDATE public.orders
        SET status = 'delivered',
            updated_at = now()
        WHERE id = p_order_id
        RETURNING updated_at INTO v_updated_at;

        RETURN jsonb_build_object(
            'id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'delivered',
            'updated_at', v_updated_at
        );

    ELSE
        RAISE EXCEPTION 'Transição de status inválida de "%" para "%".',
            v_order.status, p_new_status USING ERRCODE = '22000';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.manage_order_status_internal(UUID, TEXT, UUID) IS 'RPC interna de gestão de status de pedidos com controle atômico de estoque e autenticação server-side do operador. Concedida exclusivamente a service_role.';

-- -----------------------------------------------------------------------------
-- 3. PERMISSÕES DA RPC INTERNA: EXCLUSIVAMENTE service_role
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.manage_order_status_internal(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_order_status_internal(UUID, TEXT, UUID) TO service_role;

COMMIT;
