import React, { useState, useRef } from 'react';
import { 
  X, 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Loader2, 
  Download, 
  CheckSquare, 
  Eye, 
  ArrowRight,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { Product } from '../../types';
import { 
  parseManifestJson, 
  performBulkImageDryRun, 
  executeSequentialBulkImageImport, 
  ManifestEntry, 
  DryRunItem, 
  DryRunSummary, 
  BulkImportReport 
} from '../../services/bulkImageImportService';

interface ProductBulkImageImportModalProps {
  products: Product[];
  effectiveTenantId: string;
  onClose: () => void;
  onReload: () => void;
  showToast: (msg: string) => void;
}

export const ProductBulkImageImportModal: React.FC<ProductBulkImageImportModalProps> = ({
  products,
  effectiveTenantId,
  onClose,
  onReload,
  showToast,
}) => {
  // Arquivos carregados
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [manifestEntries, setManifestEntries] = useState<ManifestEntry[] | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [selectedImageFiles, setSelectedImageFiles] = useState<File[]>([]);

  // Estados do Dry-Run
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryRunResults, setDryRunResults] = useState<{
    items: DryRunItem[];
    summary: DryRunSummary;
  } | null>(null);
  const [dryRunFilter, setDryRunFilter] = useState<'all' | 'ready' | 'skipped' | 'blocked' | 'unused'>('all');

  // Estados de Execução da Importação
  const [isImporting, setIsImporting] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<{
    current: number;
    total: number;
    currentSku: string;
  }>({ current: 0, total: 0, currentSku: '' });

  // Relatório Final
  const [importReport, setImportReport] = useState<BulkImportReport | null>(null);

  const manifestInputRef = useRef<HTMLInputElement | null>(null);
  const imagesInputRef = useRef<HTMLInputElement | null>(null);

  // Manipulador de leitura do manifest.json
  const handleManifestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setManifestFile(file);
    setManifestError(null);
    setDryRunResults(null);
    setImportReport(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== 'string') {
        setManifestError('Não foi possível ler o arquivo manifest.json.');
        return;
      }

      const parseResult = parseManifestJson(content);
      if (!parseResult.valid || !parseResult.entries) {
        setManifestError(parseResult.error || 'Erro ao validar manifest.json.');
        setManifestEntries(null);
      } else {
        setManifestEntries(parseResult.entries);
        setManifestError(null);
      }
    };
    reader.onerror = () => {
      setManifestError('Erro ao abrir o arquivo manifest.json.');
    };
    reader.readAsText(file);
  };

  // Manipulador de seleção de imagens
  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const filesArray = Array.from(e.target.files);
    setSelectedImageFiles(filesArray);
    setDryRunResults(null);
    setImportReport(null);
  };

  // Executar Dry-Run
  const handleRunDryRun = async () => {
    if (!manifestEntries || selectedImageFiles.length === 0) return;

    setIsDryRunning(true);
    setDryRunResults(null);
    setImportReport(null);

    try {
      const results = await performBulkImageDryRun({
        manifestEntries,
        selectedFiles: selectedImageFiles,
        products,
        effectiveTenantId,
      });

      setDryRunResults(results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar dry-run';
      showToast(`Erro no dry-run: ${msg}`);
    } finally {
      setIsDryRunning(false);
    }
  };

  // Executar Importação Sequencial
  const handleStartImport = async () => {
    if (!dryRunResults || dryRunResults.summary.ready === 0 || isImporting) return;

    const readyItems = dryRunResults.items.filter(i => i.status === 'READY');
    if (readyItems.length === 0) return;

    setIsImporting(true);
    setCurrentProgress({ current: 0, total: readyItems.length, currentSku: '' });

    try {
      const report = await executeSequentialBulkImageImport({
        readyItems,
        allDryRunItems: dryRunResults.items,
        effectiveTenantId,
        products,
        onProgress: (current, total, currentSku) => {
          setCurrentProgress({ current, total, currentSku });
        },
      });

      setImportReport(report);
      showToast(
        `${report.total} processados: ${report.success} importados, ${report.failed} falhas, ${report.skipped} ignorados.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro durante o processo de importação';
      showToast(`Erro na importação: ${msg}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Baixar Relatório JSON
  const handleDownloadReport = () => {
    if (!importReport) return;
    const cleanReport = {
      tenantId: importReport.tenantId,
      startedAt: importReport.startedAt,
      finishedAt: importReport.finishedAt,
      total: importReport.total,
      success: importReport.success,
      failed: importReport.failed,
      skipped: importReport.skipped,
      items: importReport.items,
    };

    const blob = new Blob([JSON.stringify(cleanReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_importacao_fotos_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Finalização e Fechamento
  const handleFinishAndClose = () => {
    onReload();
    onClose();
  };

  // Filtragem dos itens de Dry-Run
  const filteredDryRunItems = dryRunResults
    ? dryRunResults.items.filter(item => {
        if (dryRunFilter === 'ready') return item.status === 'READY';
        if (dryRunFilter === 'skipped') return item.status === 'SKIPPED_EXISTING_IMAGE';
        if (dryRunFilter === 'blocked') return item.status.startsWith('BLOCKED_');
        if (dryRunFilter === 'unused') return item.status === 'UNUSED_FILE';
        return true;
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm shadow-blue-500/20">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                Importar Fotos em Massa por SKU
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  V1 Fail-Closed
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Associação estrita por SKU com dry-run obrigatório e preservação de fotos existentes.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isImporting}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700">
          {/* Seção 1: Seleção de Arquivos (Manifest + Imagens) */}
          {!importReport && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card Manifest */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-1">
                    <FileText className="w-4 h-4 text-blue-600" />
                    1. Arquivo de Manifesto (manifest.json)
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                    Arquivo JSON com mapeamento de <code className="bg-slate-200/80 px-1 py-0.5 rounded text-[10px] font-mono">sku</code> e <code className="bg-slate-200/80 px-1 py-0.5 rounded text-[10px] font-mono">arquivo</code>.
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    ref={manifestInputRef}
                    accept=".json,application/json"
                    onChange={handleManifestChange}
                    disabled={isImporting}
                    className="hidden"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => manifestInputRef.current?.click()}
                      disabled={isImporting}
                      className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:border-blue-500 text-xs font-bold text-slate-700 hover:text-blue-600 flex items-center gap-2 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {manifestFile ? 'Trocar manifest.json' : 'Selecionar manifest.json'}
                    </button>

                    {manifestFile && (
                      <span className="text-xs font-mono font-medium text-slate-600 truncate max-w-[180px]">
                        {manifestFile.name}
                      </span>
                    )}
                  </div>

                  {manifestEntries && (
                    <div className="mt-2 text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {manifestEntries.length} itens mapeados com sucesso.
                    </div>
                  )}

                  {manifestError && (
                    <div className="mt-2 text-[11px] text-red-600 font-medium flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{manifestError}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Imagens */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-1">
                    <UploadCloud className="w-4 h-4 text-emerald-600" />
                    2. Arquivos de Imagens (WebP, PNG, JPG)
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                    Selecione as fotos correspondentes aos SKUs. Máximo de 1 MiB por foto com verificação binária.
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    ref={imagesInputRef}
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    multiple
                    onChange={handleImagesChange}
                    disabled={isImporting}
                    className="hidden"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => imagesInputRef.current?.click()}
                      disabled={isImporting}
                      className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:border-emerald-500 text-xs font-bold text-slate-700 hover:text-emerald-600 flex items-center gap-2 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      {selectedImageFiles.length > 0 ? 'Alterar Seleção de Fotos' : 'Selecionar Fotos'}
                    </button>

                    {selectedImageFiles.length > 0 && (
                      <span className="text-xs font-semibold text-slate-700">
                        {selectedImageFiles.length} foto(s) selecionada(s)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Botão de Dry-Run */}
          {!importReport && !dryRunResults && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-200 rounded-3xl bg-slate-50/30 text-center space-y-3">
              <ShieldCheck className="w-10 h-10 text-blue-600" />
              <div>
                <h4 className="text-sm font-bold text-slate-900">Dry-Run Obrigatório de Segurança</h4>
                <p className="text-xs text-slate-500 max-w-md mt-1">
                  Nenhum upload é feito nesta fase. O sistema simula a validação de cada SKU, tenant ownership, integridade binária do arquivo e fotos já existentes.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRunDryRun}
                disabled={!manifestEntries || selectedImageFiles.length === 0 || isDryRunning}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDryRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Executando Dry-Run...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Executar Dry-Run
                  </>
                )}
              </button>
            </div>
          )}

          {/* Visualização dos Resultados do Dry-Run */}
          {!importReport && dryRunResults && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div 
                  onClick={() => setDryRunFilter('ready')}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    dryRunFilter === 'ready' 
                      ? 'border-emerald-500 bg-emerald-50/80 shadow-xs' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Prontos (READY)</span>
                  <span className="text-xl font-extrabold text-emerald-900">{dryRunResults.summary.ready}</span>
                </div>

                <div 
                  onClick={() => setDryRunFilter('skipped')}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    dryRunFilter === 'skipped' 
                      ? 'border-blue-500 bg-blue-50/80 shadow-xs' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block">Com Foto (SKIPPED)</span>
                  <span className="text-xl font-extrabold text-blue-900">{dryRunResults.summary.skippedExisting}</span>
                </div>

                <div 
                  onClick={() => setDryRunFilter('blocked')}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    dryRunFilter === 'blocked' 
                      ? 'border-red-500 bg-red-50/80 shadow-xs' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 block">Bloqueados</span>
                  <span className="text-xl font-extrabold text-red-900">{dryRunResults.summary.blocked}</span>
                </div>

                <div 
                  onClick={() => setDryRunFilter('unused')}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    dryRunFilter === 'unused' 
                      ? 'border-amber-500 bg-amber-50/80 shadow-xs' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Não Utilizados</span>
                  <span className="text-xl font-extrabold text-amber-900">{dryRunResults.summary.unused}</span>
                </div>
              </div>

              {/* Tabela Detalhada do Dry-Run */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">Tabela de Análise Prévia</span>
                    <span className="text-[11px] text-slate-500">
                      ({filteredDryRunItems.length} de {dryRunResults.items.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDryRunFilter('all')}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                        dryRunFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={handleRunDryRun}
                      disabled={isImporting}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-blue-50 flex items-center gap-1 cursor-pointer"
                      title="Reexecutar simulação"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reavaliar
                    </button>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3">Produto</th>
                        <th className="py-2 px-3">Arquivo</th>
                        <th className="py-2 px-3 text-center">Status</th>
                        <th className="py-2 px-3">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDryRunItems.map((item, idx) => (
                        <tr key={`${item.sku}-${item.filename}-${idx}`} className="hover:bg-slate-50/60">
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">{item.sku}</td>
                          <td className="py-2 px-3 font-medium text-slate-700 truncate max-w-[160px]" title={item.productName}>
                            {item.productName}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600">{item.filename}</td>
                          <td className="py-2 px-3 text-center">
                            {item.status === 'READY' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                READY
                              </span>
                            )}
                            {item.status === 'SKIPPED_EXISTING_IMAGE' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                                SKIPPED
                              </span>
                            )}
                            {item.status.startsWith('BLOCKED_') && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                {item.status.replace('BLOCKED_', '')}
                              </span>
                            )}
                            {item.status === 'UNUSED_FILE' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                UNUSED
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-500 max-w-[200px] truncate" title={item.reason}>
                            {item.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mensagem e Confirmação de Execução */}
              {!isImporting && (
                <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <h5 className="text-xs font-bold text-blue-950">Confirmação Prévia de Importação</h5>
                      <p className="text-xs text-blue-800 mt-0.5 leading-relaxed">
                        Serão importadas <strong>{dryRunResults.summary.ready}</strong> imagens para <strong>{dryRunResults.summary.ready}</strong> produtos.
                        Produtos que já possuem foto serão preservados.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStartImport}
                    disabled={dryRunResults.summary.ready === 0 || isImporting}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shrink-0 shadow-sm shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckSquare className="w-4 h-4" />
                    Iniciar Importação
                  </button>
                </div>
              )}

              {/* Estado Ativo de Importação Sequencial */}
              {isImporting && (
                <div className="bg-slate-900 text-white rounded-2xl p-5 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      Importando sequencialmente ({currentProgress.current} de {currentProgress.total})...
                    </span>
                    <span className="font-mono text-blue-300">
                      {Math.round((currentProgress.current / currentProgress.total) * 100)}%
                    </span>
                  </div>

                  {/* Barra de Progresso */}
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${(currentProgress.current / currentProgress.total) * 100}%` }}
                    />
                  </div>

                  {currentProgress.currentSku && (
                    <div className="text-[11px] text-slate-400 font-mono">
                      Processando agora: <strong className="text-white">{currentProgress.currentSku}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Relatório Final Concluído */}
          {importReport && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-emerald-950 flex items-start gap-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-emerald-900">Importação em Massa Concluída</h4>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    O processamento do lote foi finalizado. As fotos vinculadas foram salvas e refletidas no catálogo administrativo.
                  </p>
                </div>
              </div>

              {/* Estatísticas Finais */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                  <span className="text-[10px] font-bold uppercase text-emerald-700 block">Importadas com Sucesso</span>
                  <span className="text-2xl font-black text-emerald-600">{importReport.success}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                  <span className="text-[10px] font-bold uppercase text-blue-700 block">Ignoradas (Já com foto)</span>
                  <span className="text-2xl font-black text-blue-600">{importReport.skipped}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                  <span className="text-[10px] font-bold uppercase text-red-700 block">Falhas / Erros</span>
                  <span className="text-2xl font-black text-red-600">{importReport.failed}</span>
                </div>
              </div>

              {/* Botões de Ação do Relatório */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Relatório JSON
                </button>

                <button
                  type="button"
                  onClick={handleFinishAndClose}
                  className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
                >
                  Concluir e Atualizar Catálogo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs shrink-0">
          <span className="text-slate-400 text-[11px] font-mono">
            Tenant: {effectiveTenantId}
          </span>

          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2 rounded-xl text-slate-600 hover:text-slate-900 font-bold hover:bg-slate-100 transition-colors disabled:opacity-30 cursor-pointer"
          >
            {importReport ? 'Fechar' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
};
