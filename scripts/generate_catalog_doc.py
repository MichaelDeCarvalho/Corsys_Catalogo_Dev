import re
import os

with open("src/data/mcCatalogProducts.ts", "r", encoding="utf-8") as f:
    code = f.read()

products = []
raw_products = code.split("  {\n    id: ")
for p in raw_products[1:]:
    p_str = "  {\n    id: " + p
    sku = re.search(r'sku:\s*[\'"]([^\'"]+)[\'"]', p_str)
    name = re.search(r'name:\s*[\'"]([^\'"]+)[\'"]', p_str)
    cat = re.search(r'category:\s*[\'"]([^\'"]+)[\'"]', p_str)
    subcat = re.search(r'subcategory:\s*[\'"]([^\'"]+)[\'"]', p_str)
    price = re.search(r'price:\s*([\d\.]+)', p_str)
    wholesale = re.search(r'wholesalePrice:\s*([\d\.]+)', p_str)
    stock = re.search(r'stock:\s*([\d]+)', p_str)
    desc = re.search(r'description:\s*[\'"]([^\'"]+)[\'"]', p_str)

    if sku and name:
        products.append({
            "sku": sku.group(1),
            "name": name.group(1),
            "category": cat.group(1) if cat else "Outros",
            "subcategory": subcat.group(1) if subcat else "-",
            "price": float(price.group(1)) if price else 0.0,
            "wholesale": float(wholesale.group(1)) if wholesale else 0.0,
            "stock": int(stock.group(1)) if stock else 0,
            "desc": desc.group(1) if desc else ""
        })

by_cat = {}
for p in products:
    by_cat.setdefault(p["category"], []).append(p)

md = []
md.append("# 📦 03. Catálogo Técnico de Produtos MC Distribuição\n")
md.append("Catálogo técnico completo com as **92 referências industriais** importadas do banco de dados oficial da **MC Distribuição**, com foco nos setores de Marmorarias, Construção Civil, Serralherias e Indústria Metalmecânica.\n")
md.append("## Resumo Geral do Mix por Categoria\n")
md.append("| Categoria | Quantidade de Itens | Aplicações e Detalhes |")
md.append("| :--- | :--- | :--- |")
for cat, items in sorted(by_cat.items()):
    md.append(f"| **{cat}** | {len(items)} produtos | Usinagem, acabamento, corte e montagem |")

md.append("\n---\n")

for cat, items in sorted(by_cat.items()):
    md.append(f"## 📁 Categoria: {cat} ({len(items)} itens)\n")
    md.append("| SKU | Nome do Produto | Subcategoria | Preço Tabela | Preço Atacado | Estoque Inicial |")
    md.append("| :--- | :--- | :--- | :--- | :--- | :--- |")
    for p in sorted(items, key=lambda x: x["sku"]):
        s_sku = p["sku"]
        s_name = p["name"]
        s_sub = p["subcategory"]
        s_pr = p["price"]
        s_wh = p["wholesale"]
        s_st = p["stock"]
        md.append(f"| `{s_sku}` | {s_name} | {s_sub} | R$ {s_pr:.2f} | R$ {s_wh:.2f} | {s_st} un |")
    md.append("\n")

os.makedirs("docs", exist_ok=True)
with open("docs/03_CATALOGO_PRODUTOS_MC.md", "w", encoding="utf-8") as f:
    f.write("\n".join(md))

print(f"Generated docs/03_CATALOGO_PRODUTOS_MC.md with {len(products)} products.")
