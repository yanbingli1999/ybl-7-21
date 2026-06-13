import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, XCircle, AlertCircle, CheckCircle, X,
  RefreshCw, Wrench, Eye, FileText, Database, ArrowLeft,
  ChevronDown, ChevronUp, Search, Filter, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import type { HealthScanResult, HealthIssue, HealthIssueSeverity, HealthIssueType, RepairResult } from '../../shared/types.js';

const SEVERITY_CONFIG: Record<HealthIssueSeverity, { label: string; color: string; bgColor: string; borderColor: string; icon: typeof AlertCircle }> = {
  critical: { label: '严重', color: 'text-red-400', bgColor: 'bg-red-500/20', borderColor: 'border-red-500/40', icon: XCircle },
  error: { label: '错误', color: 'text-orange-400', bgColor: 'bg-orange-500/20', borderColor: 'border-orange-500/40', icon: AlertCircle },
  warning: { label: '警告', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', borderColor: 'border-yellow-500/40', icon: AlertTriangle },
};

const TYPE_CONFIG: Record<HealthIssueType, { label: string }> = {
  corrupted_json: { label: 'JSON损坏' },
  missing_project: { label: '缺失项目' },
  orphan_variable: { label: '孤儿变量' },
  abnormal_value: { label: '数值异常' },
  oversized_file: { label: '文件过大' },
  missing_simulation: { label: '缺失模拟' },
  orphan_simulation: { label: '孤儿模拟' },
  orphan_compare: { label: '孤儿对比' },
};

const AFFECTED_TYPE_LABELS: Record<string, string> = {
  variable: '变量',
  project: '项目',
  simulation: '模拟',
  compare: '对比记录',
  file: '文件',
};

export default function HealthCheckPage() {
  const { setLoading, setError } = useAppStore();
  const [scanResult, setScanResult] = useState<HealthScanResult | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [previewIssue, setPreviewIssue] = useState<HealthIssue | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<HealthIssueSeverity | 'all'>('all');
  const [filterType, setFilterType] = useState<HealthIssueType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setLoading(true);
    setRepairResult(null);
    try {
      const result = await api.health.scan();
      setScanResult(result);
      setSelectedIssues(new Set());
      setExpandedIssue(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setLoading(false);
      setIsScanning(false);
    }
  }, [setLoading, setError]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  const toggleIssueSelection = (issueId: string, canAutoFix: boolean) => {
    if (!canAutoFix) return;
    setSelectedIssues(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  };

  const toggleExpand = (issueId: string) => {
    setExpandedIssue(prev => prev === issueId ? null : issueId);
  };

  const selectAllAutoFixable = () => {
    if (!scanResult) return;
    const autoFixableIds = scanResult.issues
      .filter(i => i.canAutoFix && matchesFilter(i))
      .map(i => i.id);
    setSelectedIssues(new Set(autoFixableIds));
  };

  const clearSelection = () => {
    setSelectedIssues(new Set());
  };

  const matchesFilter = (issue: HealthIssue): boolean => {
    if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
    if (filterType !== 'all' && issue.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        issue.title.toLowerCase().includes(q) ||
        issue.description.toLowerCase().includes(q) ||
        (issue.affectedName?.toLowerCase().includes(q)) ||
        TYPE_CONFIG[issue.type].label.toLowerCase().includes(q)
      );
    }
    return true;
  };

  const handleRepair = async () => {
    if (selectedIssues.size === 0) return;
    setShowConfirmModal(false);
    setRepairing(true);
    setLoading(true);
    try {
      const result = await api.health.repair({ issueIds: Array.from(selectedIssues) });
      setRepairResult(result);
      if (result.success || result.fixedCount > 0) {
        await runScan();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '修复失败');
    } finally {
      setLoading(false);
      setRepairing(false);
    }
  };

  const filteredIssues = scanResult?.issues.filter(matchesFilter) || [];
  const autoFixableCount = filteredIssues.filter(i => i.canAutoFix).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-monte-border">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-4 mb-4">
            <Link to="/" className="p-2 rounded-lg text-monte-muted hover:text-white hover:bg-monte-border transition-all">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-monte-accent/10 border border-monte-accent/30 mb-3">
                <Activity className="w-4 h-4 text-monte-accent" />
                <span className="text-xs font-medium text-monte-accent uppercase tracking-wider">系统维护</span>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">数据健康检查</h1>
              <p className="text-monte-muted">扫描项目、变量、模拟和对比记录之间的关联，检测数据异常并提供安全修复</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={runScan} disabled={isScanning} className="btn-primary">
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? '扫描中...' : '重新扫描'}
            </button>
            {scanResult && (
              <span className="text-sm text-monte-muted">
                上次扫描: {new Date(scanResult.scannedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>

          {scanResult && selectedIssues.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-monte-muted">
                已选择 {selectedIssues.size} 项可自动修复
              </span>
              <button onClick={() => setShowConfirmModal(true)} disabled={repairing} className="btn-success">
                <Wrench className="w-4 h-4" />
                修复选中项
              </button>
            </div>
          )}
        </div>

        {scanResult && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="card text-center">
                <div className="text-3xl font-bold text-white font-mono mb-1">{scanResult.dataCounts.projects}</div>
                <div className="text-xs text-monte-muted uppercase tracking-wider">项目总数</div>
              </div>
              <div className="card text-center">
                <div className="text-3xl font-bold text-monte-accent font-mono mb-1">{scanResult.dataCounts.variables}</div>
                <div className="text-xs text-monte-muted uppercase tracking-wider">变量总数</div>
              </div>
              <div className="card text-center">
                <div className="text-3xl font-bold text-monte-safe font-mono mb-1">{scanResult.dataCounts.simulations}</div>
                <div className="text-xs text-monte-muted uppercase tracking-wider">模拟总数</div>
              </div>
              <div className="card text-center">
                <div className="text-3xl font-bold text-purple-400 font-mono mb-1">{scanResult.dataCounts.comparisons}</div>
                <div className="text-xs text-monte-muted uppercase tracking-wider">对比总数</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {(['critical', 'error', 'warning'] as HealthIssueSeverity[]).map(sev => {
                const cfg = SEVERITY_CONFIG[sev];
                const Icon = cfg.icon;
                const count = scanResult.issuesBySeverity[sev];
                return (
                  <div key={sev} className={`card border ${cfg.borderColor} ${cfg.bgColor}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className={`w-5 h-5 ${cfg.color}`} />
                          <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                        </div>
                        <div className={`text-4xl font-bold font-mono ${cfg.color}`}>{count}</div>
                        <div className="text-xs text-monte-muted mt-1">个问题</div>
                      </div>
                      <button
                        onClick={() => setFilterSeverity(filterSeverity === sev ? 'all' : sev)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                          filterSeverity === sev
                            ? 'bg-white/10 text-white border border-white/20'
                            : 'text-monte-muted hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {filterSeverity === sev ? '显示全部' : '仅显示此类'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card mb-8">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-monte-accent" />
                数据文件大小
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {scanResult.fileSizes.map(file => (
                  <div key={file.type} className="p-4 rounded-xl bg-monte-bg/50 border border-monte-border">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-monte-muted" />
                      <span className="text-sm font-medium text-white">{file.type}</span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-monte-accent mb-1">
                      {file.sizeMB < 1 ? `${file.sizeKB.toFixed(1)} KB` : `${file.sizeMB.toFixed(2)} MB`}
                    </div>
                    <div className="text-xs text-monte-muted">
                      {file.count} 条记录 · {file.sizeBytes.toLocaleString()} 字节
                    </div>
                    {file.sizeMB > 10 && (
                      <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        文件过大，建议清理
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-monte-warn" />
                  问题列表
                  <span className="text-sm font-normal text-monte-muted">
                    ({filteredIssues.length} 项{filterSeverity !== 'all' || filterType !== 'all' ? ' · 已筛选' : ''})
                  </span>
                </h3>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-monte-muted" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="搜索问题..."
                      className="input pl-9 w-48"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-monte-muted" />
                    <select
                      value={filterSeverity}
                      onChange={e => setFilterSeverity(e.target.value as HealthIssueSeverity | 'all')}
                      className="input w-32"
                    >
                      <option value="all">全部严重度</option>
                      <option value="critical">严重</option>
                      <option value="error">错误</option>
                      <option value="warning">警告</option>
                    </select>
                    <select
                      value={filterType}
                      onChange={e => setFilterType(e.target.value as HealthIssueType | 'all')}
                      className="input w-36"
                    >
                      <option value="all">全部类型</option>
                      {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>

                  {autoFixableCount > 0 && (
                    <div className="flex gap-2">
                      <button onClick={selectAllAutoFixable} className="btn-secondary text-sm">
                        全选可修复
                      </button>
                      <button onClick={clearSelection} className="btn-secondary text-sm">
                        清除选择
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {filteredIssues.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle className="w-16 h-16 text-monte-safe mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {scanResult.totalIssues === 0 ? '数据状态良好' : '没有匹配的问题'}
                  </h3>
                  <p className="text-monte-muted">
                    {scanResult.totalIssues === 0
                      ? '所有数据关联正常，未发现异常问题。'
                      : '尝试调整筛选条件查看其他问题。'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredIssues.map(issue => {
                    const sevCfg = SEVERITY_CONFIG[issue.severity];
                    const SevIcon = sevCfg.icon;
                    const isExpanded = expandedIssue === issue.id;
                    const isSelected = selectedIssues.has(issue.id);

                    return (
                      <div
                        key={issue.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? `border-monte-accent/50 bg-monte-accent/5`
                            : `${sevCfg.borderColor} bg-monte-bg/30 hover:bg-monte-bg/50`
                        }`}
                      >
                        <div className="p-4 flex items-start gap-3">
                          <div className="pt-0.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleIssueSelection(issue.id, issue.canAutoFix)}
                              disabled={!issue.canAutoFix}
                              className="w-4 h-4 rounded border-monte-border bg-monte-card text-monte-accent focus:ring-monte-accent disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className={`p-1.5 rounded-lg ${sevCfg.bgColor} flex-shrink-0`}>
                            <SevIcon className={`w-4 h-4 ${sevCfg.color}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <h4 className="font-semibold text-white">{issue.title}</h4>
                                  <span className={`badge ${sevCfg.bgColor} ${sevCfg.color} border ${sevCfg.borderColor}`}>
                                    {sevCfg.label}
                                  </span>
                                  <span className="badge bg-monte-card border border-monte-border text-monte-muted">
                                    {TYPE_CONFIG[issue.type].label}
                                  </span>
                                  {!issue.canAutoFix && (
                                    <span className="badge bg-monte-muted/10 border border-monte-muted/30 text-monte-muted">
                                      需手动修复
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-monte-muted mb-1">{issue.description}</p>
                                <div className="flex items-center gap-4 text-xs text-monte-muted">
                                  <span>类型: {AFFECTED_TYPE_LABELS[issue.affectedType]}</span>
                                  {issue.affectedName && <span>名称: {issue.affectedName}</span>}
                                  {issue.affectedId && (
                                    <span className="font-mono">ID: {issue.affectedId.slice(0, 8)}...</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                  onClick={() => setPreviewIssue(issue)}
                                  className="p-2 rounded-lg text-monte-muted hover:text-white hover:bg-monte-border transition-all"
                                  title="预览详情"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => toggleExpand(issue.id)}
                                  className="p-2 rounded-lg text-monte-muted hover:text-white hover:bg-monte-border transition-all"
                                  title={isExpanded ? '收起' : '展开'}
                                >
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mt-4 pt-4 border-t border-monte-border">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <h5 className="text-xs font-semibold text-monte-muted uppercase tracking-wider mb-2">
                                      修复建议
                                    </h5>
                                    <p className="text-sm text-white">{issue.fixSuggestion}</p>
                                    {!issue.canAutoFix && (
                                      <p className="text-xs text-monte-warn mt-2 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        此问题需要手动检查和修复
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <h5 className="text-xs font-semibold text-monte-muted uppercase tracking-wider mb-2">
                                      数据预览
                                    </h5>
                                    <pre className="text-xs bg-monte-bg border border-monte-border rounded-lg p-3 overflow-auto max-h-48 font-mono text-monte-muted">
                                      {JSON.stringify(issue.preview, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {repairResult && (
              <div className={`mt-6 card border ${repairResult.success ? 'border-monte-safe/40 bg-monte-safe/10' : 'border-monte-danger/40 bg-monte-danger/10'}`}>
                <h3 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${repairResult.success ? 'text-monte-safe' : 'text-monte-danger'}`}>
                  {repairResult.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  修复结果
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-2xl font-bold font-mono text-monte-safe">{repairResult.fixedCount}</div>
                    <div className="text-xs text-monte-muted">成功修复</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono text-monte-danger">{repairResult.failedCount}</div>
                    <div className="text-xs text-monte-muted">修复失败</div>
                  </div>
                </div>
                <div className="space-y-2 max-h-60 overflow-auto">
                  {repairResult.results.map((r, idx) => (
                    <div key={idx} className={`text-sm p-2 rounded-lg ${r.success ? 'bg-monte-safe/10' : 'bg-monte-danger/10'}`}>
                      <span className={`font-mono mr-2 ${r.success ? 'text-monte-safe' : 'text-monte-danger'}`}>
                        {r.success ? '✓' : '✗'}
                      </span>
                      <span className="text-white">{r.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {previewIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-2xl shadow-2xl max-h-[80vh] overflow-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-2">数据详情预览</h2>
                <p className="text-sm text-monte-muted">只读模式，请确认数据后再执行修复操作</p>
              </div>
              <button
                onClick={() => setPreviewIssue(null)}
                className="p-2 rounded-lg text-monte-muted hover:text-white hover:bg-monte-border transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">问题类型</label>
                  <div className="text-white">{TYPE_CONFIG[previewIssue.type].label}</div>
                </div>
                <div>
                  <label className="label">严重程度</label>
                  <div className={SEVERITY_CONFIG[previewIssue.severity].color}>
                    {SEVERITY_CONFIG[previewIssue.severity].label}
                  </div>
                </div>
                <div>
                  <label className="label">影响类型</label>
                  <div className="text-white">{AFFECTED_TYPE_LABELS[previewIssue.affectedType]}</div>
                </div>
                {previewIssue.affectedId && (
                  <div>
                    <label className="label">关联ID</label>
                    <div className="text-white font-mono text-sm">{previewIssue.affectedId}</div>
                  </div>
                )}
              </div>

              <div>
                <label className="label">问题描述</label>
                <div className="text-white">{previewIssue.description}</div>
              </div>

              <div>
                <label className="label">修复建议</label>
                <div className={`p-3 rounded-lg ${previewIssue.canAutoFix ? 'bg-monte-safe/10 text-monte-safe' : 'bg-monte-warn/10 text-monte-warn'}`}>
                  {previewIssue.fixSuggestion}
                </div>
              </div>

              <div>
                <label className="label">完整数据预览</label>
                <pre className="bg-monte-bg border border-monte-border rounded-lg p-4 overflow-auto max-h-64 text-sm font-mono text-monte-muted">
                  {JSON.stringify(previewIssue.preview, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t border-monte-border">
              <button onClick={() => setPreviewIssue(null)} className="btn-secondary flex-1">
                关闭
              </button>
              {previewIssue.canAutoFix && (
                <button
                  onClick={() => {
                    setSelectedIssues(prev => new Set([...prev, previewIssue.id]));
                    setPreviewIssue(null);
                  }}
                  className="btn-primary flex-1"
                >
                  <Wrench className="w-4 h-4" />
                  加入修复队列
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-monte-warn/10 border border-monte-warn/30 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-monte-warn" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">确认修复操作</h2>
              <p className="text-monte-muted">
                您即将修复 <span className="text-white font-semibold">{selectedIssues.size}</span> 个问题。
                此操作将永久删除或修改数据，请确认已预览所有相关数据。
              </p>
            </div>

            <div className="bg-monte-bg border border-monte-border rounded-lg p-4 mb-6">
              <h3 className="text-sm font-semibold text-white mb-2">修复内容包括：</h3>
              <ul className="text-sm text-monte-muted space-y-1">
                <li className="flex items-start gap-2">
                  <Trash2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-monte-danger" />
                  <span>删除孤儿变量、模拟和对比记录</span>
                </li>
                <li className="flex items-start gap-2">
                  <Wrench className="w-4 h-4 flex-shrink-0 mt-0.5 text-monte-accent" />
                  <span>清理对比记录中缺失的模拟引用</span>
                </li>
                <li className="flex items-start gap-2">
                  <Database className="w-4 h-4 flex-shrink-0 mt-0.5 text-monte-safe" />
                  <span>清除过大的模拟采样数据（保留统计结果）</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowConfirmModal(false)} className="btn-secondary flex-1">
                取消
              </button>
              <button onClick={handleRepair} disabled={repairing} className="btn-danger flex-1">
                {repairing ? '修复中...' : '确认修复'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
