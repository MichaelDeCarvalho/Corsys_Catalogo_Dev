import csv
import os

def parse_price(val):
    val = val.replace('R$', '').strip()
    if val in ['-', '', 'null', 'NULL']:
        return None
    val = val.replace('.', '').replace(',', '.')
    return round(float(val), 2)

def escape_sql(text):
    if text is None:
        return 'NULL'
    return "'" + text.replace("'", "''") + "'"

def main():
    raw_path = 'scripts/raw_input.csv'
    with open(raw_path, 'r', encoding='utf-8') as f:
        lines = [l.strip() for l in f if l.strip()]

    header = lines[0].split(';')
    data = lines[1:]

    print(f"Lendo {len(data)} linhas de dados brutos...")
    
    records = []
    seen_skus = set()
    null_wholesale_count = 0

    for idx, line in enumerate(data):
        parts = [p.strip() for p in line.split(';')]
        # A fonte bruta tem: Família;Cod.Prod.;Produto;Estoque;Estoque Michael;Valor custo mercadoria;Valor varejo;Valor atacado
        # Porém a regra exige que estoque_michael seja 100% descartado/ignorado.
        fam = parts[0].strip()
        sku = parts[1].strip()
        prod = parts[2].strip()
        est = parts[3].strip()
        # parts[4] é descartado completamente
        custo = parts[5].strip()
        varejo = parts[6].strip()
        atacado = parts[7].strip()

        # Limpeza de aspas externas do nome
        if prod.startswith('"') and prod.endswith('"'):
            prod = prod[1:-1].replace('""', '"').strip()

        stock = int(est)
        cost = parse_price(custo)
        retail = parse_price(varejo)
        wholesale = parse_price(atacado)

        if sku in seen_skus:
            raise ValueError(f"SKU duplicado encontrado no processamento: {sku}")
        seen_skus.add(sku)

        if wholesale is None:
            null_wholesale_count += 1

        records.append({
            'sku': sku,
            'name': prod,
            'category': fam,
            'stock': stock,
            'cost_price': cost,
            'retail_price': retail,
            'wholesale_price': wholesale
        })

    total_records = len(records)
    print(f"Total de registros oficiais validados: {total_records}")
    print(f"Total de atacados NULL: {null_wholesale_count}")

    # 1. Salvar CSV Canônico com EXATAMENTE 7 colunas
    csv_out_path = 'data/imports/catalogo_oficial_20260903.csv'
    os.makedirs(os.path.dirname(csv_out_path), exist_ok=True)
    with open(csv_out_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['sku', 'name', 'category', 'stock', 'cost_price', 'retail_price', 'wholesale_price'])
        for r in records:
            writer.writerow([
                r['sku'],
                r['name'],
                r['category'],
                r['stock'],
                f"{r['cost_price']:.2f}",
                f"{r['retail_price']:.2f}",
                f"{r['wholesale_price']:.2f}" if r['wholesale_price'] is not None else ''
            ])
    print(f"CSV canônico gerado em: {csv_out_path}")

    # 2. Gerar Migration SQL 000002 com regras estritas:
    # - Staging sem stock_michael
    # - Validação de tenant existente (slug = 'corsys-catalogo-demo', status = 'active') SEM PROVISIONAR
    # - Validação fail-closed de tenant limpo (COUNT(*) = 0 em products) SEM UPSERT
    # - INSERT simples dos 520 produtos com brand = NULL, technical_specs = '{}'::jsonb, unit = 'un', min_order_quantity = 1
    sql_out_path = 'supabase/migrations/20260903_000002_import_official_catalog.sql'
    
    sql_lines = []
    sql_lines.append("-- =========================================================================")
    sql_lines.append("-- CORSYS CATÁLOGO B2B / B2C - MIGRATION 000002: IMPORTAÇÃO DO CATÁLOGO OFICIAL")
    sql_lines.append("-- Arquivo: supabase/migrations/20260903_000002_import_official_catalog.sql")
    sql_lines.append(f"-- Total de produtos oficiais únicos: {total_records}")
    sql_lines.append(f"-- Total com atacado nulo ('-'): {null_wholesale_count}")
    sql_lines.append("-- Integridade: Validação em staging table temporária com fail-closed estrito")
    sql_lines.append("-- Resolução de Tenant: Verificação estrita por slug 'corsys-catalogo-demo'")
    sql_lines.append("-- Zero provisionamento de tenant / Zero UPSERT / brand = NULL / technical_specs = '{}'")
    sql_lines.append("-- =========================================================================")
    sql_lines.append("")
    sql_lines.append("BEGIN;")
    sql_lines.append("")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("-- 1. TABELA TEMPORÁRIA DE STAGING (ON COMMIT DROP)")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("CREATE TEMP TABLE staging_official_catalog (")
    sql_lines.append("    sku TEXT NOT NULL,")
    sql_lines.append("    name TEXT NOT NULL,")
    sql_lines.append("    category TEXT NOT NULL,")
    sql_lines.append("    stock INTEGER NOT NULL,")
    sql_lines.append("    cost_price NUMERIC(10,2) NOT NULL,")
    sql_lines.append("    retail_price NUMERIC(10,2) NOT NULL,")
    sql_lines.append("    wholesale_price NUMERIC(10,2)")
    sql_lines.append(") ON COMMIT DROP;")
    sql_lines.append("")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("-- 2. CARGA DOS DADOS NA TABELA DE STAGING")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("INSERT INTO staging_official_catalog (sku, name, category, stock, cost_price, retail_price, wholesale_price) VALUES")
    
    values_chunks = []
    for r in records:
        w_val = f"{r['wholesale_price']:.2f}" if r['wholesale_price'] is not None else "NULL"
        values_chunks.append(
            f"({escape_sql(r['sku'])}, {escape_sql(r['name'])}, {escape_sql(r['category'])}, {r['stock']}, {r['cost_price']:.2f}, {r['retail_price']:.2f}, {w_val})"
        )
    
    sql_lines.append(",\n".join(values_chunks) + ";")
    sql_lines.append("")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("-- 3. VALIDAÇÕES FAIL-CLOSED EM STAGING & RESOLUÇÃO DE TENANT EXISTENTE")
    sql_lines.append("-- -------------------------------------------------------------------------")
    sql_lines.append("DO $$")
    sql_lines.append("DECLARE")
    sql_lines.append("    v_tenant_id UUID;")
    sql_lines.append("    v_tenant_status TEXT;")
    sql_lines.append("    v_count_tenants INTEGER;")
    sql_lines.append("    v_existing_products INTEGER;")
    sql_lines.append("    v_count_total INTEGER;")
    sql_lines.append("    v_count_distinct_sku INTEGER;")
    sql_lines.append("    v_count_dup_sku INTEGER;")
    sql_lines.append("    v_count_invalid_sku INTEGER;")
    sql_lines.append("    v_count_invalid_name INTEGER;")
    sql_lines.append("    v_count_invalid_category INTEGER;")
    sql_lines.append("    v_count_invalid_retail INTEGER;")
    sql_lines.append("    v_count_invalid_cost INTEGER;")
    sql_lines.append("    v_count_invalid_stock INTEGER;")
    sql_lines.append("    v_count_invalid_wholesale INTEGER;")
    sql_lines.append("    v_inserted_count INTEGER;")
    sql_lines.append("BEGIN")
    sql_lines.append("    -- a) Contagem total de linhas esperada na staging")
    sql_lines.append("    SELECT count(*) INTO v_count_total FROM staging_official_catalog;")
    sql_lines.append(f"    IF v_count_total <> {total_records} THEN")
    sql_lines.append(f"        RAISE EXCEPTION 'Validação staging falhou: contagem de linhas (%) diferente de {total_records}.', v_count_total;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- b) Contagem de SKUs distintos esperada na staging")
    sql_lines.append("    SELECT count(DISTINCT sku) INTO v_count_distinct_sku FROM staging_official_catalog;")
    sql_lines.append(f"    IF v_count_distinct_sku <> {total_records} THEN")
    sql_lines.append(f"        RAISE EXCEPTION 'Validação staging falhou: contagem de SKUs distintos (%) diferente de {total_records}.', v_count_distinct_sku;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- c) Unicidade de SKU (nenhum duplicado)")
    sql_lines.append("    SELECT count(*) INTO v_count_dup_sku")
    sql_lines.append("    FROM (")
    sql_lines.append("        SELECT sku FROM staging_official_catalog GROUP BY sku HAVING count(*) > 1")
    sql_lines.append("    ) d;")
    sql_lines.append("    IF v_count_dup_sku > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % SKUs duplicados na carga.', v_count_dup_sku;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- d) SKU nulo ou vazio")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_sku FROM staging_official_catalog WHERE sku IS NULL OR trim(sku) = '';")
    sql_lines.append("    IF v_count_invalid_sku > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com SKU nulo ou vazio.', v_count_invalid_sku;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- e) Nome nulo ou vazio")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_name FROM staging_official_catalog WHERE name IS NULL OR trim(name) = '';")
    sql_lines.append("    IF v_count_invalid_name > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com nome nulo ou vazio.', v_count_invalid_name;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- f) Categoria nula ou vazia")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_category FROM staging_official_catalog WHERE category IS NULL OR trim(category) = '';")
    sql_lines.append("    IF v_count_invalid_category > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com categoria nula ou vazia.', v_count_invalid_category;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- g) Preço varejo inválido (<= 0 ou nulo)")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_retail FROM staging_official_catalog WHERE retail_price IS NULL OR retail_price <= 0;")
    sql_lines.append("    IF v_count_invalid_retail > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com preço de varejo <= 0.', v_count_invalid_retail;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- h) Preço custo inválido (<= 0 ou nulo)")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_cost FROM staging_official_catalog WHERE cost_price IS NULL OR cost_price <= 0;")
    sql_lines.append("    IF v_count_invalid_cost > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com preço de custo <= 0.', v_count_invalid_cost;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- i) Estoque inválido (< 0 ou nulo)")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_stock FROM staging_official_catalog WHERE stock IS NULL OR stock < 0;")
    sql_lines.append("    IF v_count_invalid_stock > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com estoque negativo ou nulo.', v_count_invalid_stock;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- j) Atacado inválido (se não nulo, deve ser > 0)")
    sql_lines.append("    SELECT count(*) INTO v_count_invalid_wholesale FROM staging_official_catalog WHERE wholesale_price IS NOT NULL AND wholesale_price <= 0;")
    sql_lines.append("    IF v_count_invalid_wholesale > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação staging falhou: existem % registros com preço de atacado <= 0.', v_count_invalid_wholesale;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    -- 4. VALIDAÇÃO ESTREITA DE TENANT EXISTENTE (FAIL-CLOSED)")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    SELECT count(*) INTO v_count_tenants FROM public.tenants WHERE slug = 'corsys-catalogo-demo';")
    sql_lines.append("    IF v_count_tenants = 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação fail-closed: Tenant com slug \"corsys-catalogo-demo\" não existe em public.tenants. A migration não cria tenants.';")
    sql_lines.append("    ELSIF v_count_tenants > 1 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação fail-closed: Múltiplos tenants (%) encontrados com slug \"corsys-catalogo-demo\".', v_count_tenants;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    SELECT id, status INTO v_tenant_id, v_tenant_status FROM public.tenants WHERE slug = 'corsys-catalogo-demo';")
    sql_lines.append("    IF v_tenant_status <> 'active' THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação fail-closed: Tenant \"corsys-catalogo-demo\" encontrado mas inativo (status: \"%\").', v_tenant_status;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    -- 5. PRECONDIÇÃO FAIL-CLOSED: TENANT NÃO DEVE POSSUIR PRODUTOS ANTERIORES")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    SELECT count(*) INTO v_existing_products FROM public.products WHERE tenant_id = v_tenant_id;")
    sql_lines.append("    IF v_existing_products > 0 THEN")
    sql_lines.append("        RAISE EXCEPTION 'Validação fail-closed: Tenant % já possui % produto(s) cadastrado(s). O bootstrap requer tenant limpo. UPSERT desativado.', v_tenant_id, v_existing_products;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    -- 6. CARGA EFETIVA EM PUBLIC.PRODUCTS (INSERT SIMPLES SEM UPSERT)")
    sql_lines.append("    -- ---------------------------------------------------------------------")
    sql_lines.append("    INSERT INTO public.products (")
    sql_lines.append("        tenant_id,")
    sql_lines.append("        sku,")
    sql_lines.append("        name,")
    sql_lines.append("        barcode,")
    sql_lines.append("        category,")
    sql_lines.append("        subcategory,")
    sql_lines.append("        brand,")
    sql_lines.append("        description,")
    sql_lines.append("        technical_specs,")
    sql_lines.append("        cost_price,")
    sql_lines.append("        price,")
    sql_lines.append("        promotional_price,")
    sql_lines.append("        wholesale_price,")
    sql_lines.append("        min_order_quantity,")
    sql_lines.append("        stock,")
    sql_lines.append("        unit,")
    sql_lines.append("        images,")
    sql_lines.append("        featured,")
    sql_lines.append("        is_new,")
    sql_lines.append("        active,")
    sql_lines.append("        sort_order,")
    sql_lines.append("        created_at,")
    sql_lines.append("        updated_at,")
    sql_lines.append("        deleted_at")
    sql_lines.append("    )")
    sql_lines.append("    SELECT")
    sql_lines.append("        v_tenant_id,")
    sql_lines.append("        s.sku,")
    sql_lines.append("        s.name,")
    sql_lines.append("        NULL,")
    sql_lines.append("        s.category,")
    sql_lines.append("        NULL,")
    sql_lines.append("        NULL,")
    sql_lines.append("        NULL,")
    sql_lines.append("        '{}'::jsonb,")
    sql_lines.append("        s.cost_price,")
    sql_lines.append("        s.retail_price,")
    sql_lines.append("        NULL,")
    sql_lines.append("        s.wholesale_price,")
    sql_lines.append("        1,")
    sql_lines.append("        s.stock,")
    sql_lines.append("        'un',")
    sql_lines.append("        ARRAY[]::TEXT[],")
    sql_lines.append("        false,")
    sql_lines.append("        false,")
    sql_lines.append("        true,")
    sql_lines.append("        0,")
    sql_lines.append("        now(),")
    sql_lines.append("        now(),")
    sql_lines.append("        NULL")
    sql_lines.append("    FROM staging_official_catalog s;")
    sql_lines.append("")
    sql_lines.append("    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;")
    sql_lines.append(f"    IF v_inserted_count <> {total_records} THEN")
    sql_lines.append(f"        RAISE EXCEPTION 'Falha crítica: Esperado {total_records} inserções, mas foram inseridos % registros.', v_inserted_count;")
    sql_lines.append("    END IF;")
    sql_lines.append("")
    sql_lines.append("    RAISE NOTICE '=======================================================';")
    sql_lines.append("    RAISE NOTICE 'BOOTSTRAP OFICIAL CONCLUÍDO COM SUCESSO:';")
    sql_lines.append(f"    RAISE NOTICE 'Tenant: corsys-catalogo-demo (UUID: %)', v_tenant_id;")
    sql_lines.append(f"    RAISE NOTICE 'Produtos inseridos: %', v_inserted_count;")
    sql_lines.append("    RAISE NOTICE '=======================================================';")
    sql_lines.append("END $$;")
    sql_lines.append("")
    sql_lines.append("COMMIT;")
    sql_lines.append("")

    with open(sql_out_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(sql_lines))

    print(f"Migration gerada com sucesso em: {sql_out_path}")
    print(f"Tamanho do arquivo SQL: {os.path.getsize(sql_out_path)} bytes")

if __name__ == '__main__':
    main()
