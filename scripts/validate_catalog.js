import fs from 'fs';

const content = fs.readFileSync('scripts/raw_input.csv', 'utf-8');

// Parse CSV with semicolon delimiter handling quotes if any
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const header = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
  console.log('Header detected:', header);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // parse line respecting quotes
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        if (inQuotes && line[c + 1] === '"') {
          cur += '"';
          c++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ';' && !inQuotes) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    fields.push(cur.trim());
    rows.push({ lineIndex: i + 1, raw: line, fields });
  }
  return { header, rows };
}

const { header, rows } = parseCSV(content);

console.log(`Total data rows: ${rows.length}`);

// Header mapping
// Família;Cod.Prod.;Produto;Estoque;Estoque Michael;Valor custo mercadoria;Valor varejo;Valor atacado
const colFamiliaIdx = header.findIndex(h => h.toLowerCase().includes('família') || h.toLowerCase().includes('familia'));
const colSkuIdx = header.findIndex(h => h.toLowerCase().includes('cod.prod') || h.toLowerCase().includes('sku') || h.toLowerCase().includes('código'));
const colProdutoIdx = header.findIndex(h => h.toLowerCase().includes('produto'));
const colEstoqueIdx = header.findIndex(h => h.toLowerCase() === 'estoque');
const colEstoqueMichaelIdx = header.findIndex(h => h.toLowerCase().includes('michael'));
const colCustoIdx = header.findIndex(h => h.toLowerCase().includes('custo'));
const colVarejoIdx = header.findIndex(h => h.toLowerCase().includes('varejo'));
const colAtacadoIdx = header.findIndex(h => h.toLowerCase().includes('atacado'));

console.log('Column indices:', {
  colFamiliaIdx,
  colSkuIdx,
  colProdutoIdx,
  colEstoqueIdx,
  colEstoqueMichaelIdx,
  colCustoIdx,
  colVarejoIdx,
  colAtacadoIdx
});

function parseMoney(val) {
  if (!val) return null;
  const clean = val.replace(/R\$/g, '').trim();
  if (clean === '-' || clean === '' || clean === 'R$ -') return 0; // or null if atacado
  // e.g. "121,90" -> 121.90, "1.234,56" -> 1234.56
  const normalized = clean.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

function parseInteger(val) {
  if (val === undefined || val === null || val === '') return null;
  const clean = String(val).trim();
  const num = parseInt(clean, 10);
  return isNaN(num) ? null : num;
}

const skuMap = new Map();
const duplicates = [];
const emptySku = [];
const emptyName = [];
const emptyCategory = [];
const invalidStock = [];
const invalidCost = [];
const invalidRetail = [];
const invalidWholesale = [];

const parsedRows = [];

for (const r of rows) {
  const f = r.fields;
  const categoria = f[colFamiliaIdx];
  const sku = f[colSkuIdx];
  const produto = f[colProdutoIdx];
  const estoque = f[colEstoqueIdx];
  const custo = f[colCustoIdx];
  const varejo = f[colVarejoIdx];
  const atacado = f[colAtacadoIdx];

  // 4. SKU vazio
  if (!sku || sku.trim() === '') {
    emptySku.push(r);
  } else {
    // 3. SKU duplicado
    if (skuMap.has(sku)) {
      duplicates.push({ sku, firstLine: skuMap.get(sku).lineIndex, currentLine: r.lineIndex, r });
    } else {
      skuMap.set(sku, r);
    }
  }

  // 5. Nome vazio
  if (!produto || produto.trim() === '') {
    emptyName.push(r);
  }

  // 6. Categoria vazia
  if (!categoria || categoria.trim() === '') {
    emptyCategory.push(r);
  }

  // 7. Estoque inválido
  const stockNum = parseInteger(estoque);
  if (stockNum === null || stockNum < 0) {
    invalidStock.push({ r, estoque });
  }

  // 8. Custo inválido
  const costNum = parseMoney(custo);
  if (costNum === null || costNum < 0) {
    invalidCost.push({ r, custo });
  }

  // 9. Varejo inválido
  const retailNum = parseMoney(varejo);
  if (retailNum === null || retailNum < 0) {
    invalidRetail.push({ r, varejo });
  }

  // 10. Atacado inválido diferente de "-"
  // "-" or empty or valid positive number is accepted. If it is "-", it maps to cost_price or null? Let's check rule:
  // "detectar atacado inválido diferente de '-'"
  const cleanAtacado = atacado ? atacado.replace(/R\$/g, '').trim() : '';
  let wholesaleNum = null;
  if (cleanAtacado === '-' || cleanAtacado === '') {
    wholesaleNum = 0; // or null / '-'
  } else {
    wholesaleNum = parseMoney(atacado);
    if (wholesaleNum === null || wholesaleNum < 0) {
      invalidWholesale.push({ r, atacado });
    }
  }

  parsedRows.push({
    lineIndex: r.lineIndex,
    categoria,
    sku,
    produto,
    estoque: stockNum,
    custo: costNum,
    varejo: retailNum,
    atacado: wholesaleNum,
    rawAtacado: atacado
  });
}

console.log('=== RESULTADOS DA VALIDAÇÃO ===');
console.log('1. Linhas de produto:', rows.length);
console.log('2. SKUs únicos:', skuMap.size);
console.log('3. SKUs duplicados:', duplicates.length, duplicates);
console.log('4. SKUs vazios:', emptySku.length);
console.log('5. Nomes vazios:', emptyName.length);
console.log('6. Categorias vazias:', emptyCategory.length);
console.log('7. Estoques inválidos:', invalidStock.length);
console.log('8. Custos inválidos:', invalidCost.length);
console.log('9. Varejos inválidos:', invalidRetail.length);
console.log('10. Atacados inválidos (diferente de -):', invalidWholesale.length);

// Count '-' in atacado
const atacadoHifen = parsedRows.filter(r => {
  const c = r.rawAtacado.replace(/R\$/g, '').trim();
  return c === '-' || c === '';
});
console.log('Atacado com "-":', atacadoHifen.length, atacadoHifen.map(x => x.sku));

// Check categories distribution
const catCounts = {};
parsedRows.forEach(r => {
  catCounts[r.categoria] = (catCounts[r.categoria] || 0) + 1;
});
console.log('Distribuição por Categoria:', catCounts);
