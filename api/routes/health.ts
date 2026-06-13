import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from '../storage/fileStore.js';
import type { Project, Variable, SimulationResult, CompareRecord, HealthIssue, HealthScanResult, FileSizeInfo, StoreType, RepairRequest, RepairResult } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');

const router = Router();

const projectsStore = createStore<Project>('projects');
const variablesStore = createStore<Variable>('variables');
const simulationsStore = createStore<SimulationResult>('simulations');
const comparisonsStore = createStore<CompareRecord>('comparisons');

const FILES: Record<StoreType, string> = {
  projects: 'projects.json',
  variables: 'variables.json',
  simulations: 'simulations.json',
  comparisons: 'comparisons.json',
};

const MAX_FILE_SIZE_MB = 10;
const MAX_SIMULATION_SAMPLES = 100000;

function stableId(...parts: string[]): string {
  const raw = parts.join('::');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function getFileSizeInfo(type: StoreType, count: number): FileSizeInfo {
  const filePath = path.join(DATA_DIR, FILES[type]);
  let sizeBytes = 0;
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    sizeBytes = stats.size;
  }
  return {
    type,
    path: filePath,
    sizeBytes,
    sizeKB: sizeBytes / 1024,
    sizeMB: sizeBytes / (1024 * 1024),
    count,
  };
}

function checkFileCorruption(type: StoreType): { corrupted: boolean; error?: string; rawContent?: string } {
  const filePath = path.join(DATA_DIR, FILES[type]);
  if (!fs.existsSync(filePath)) {
    return { corrupted: false };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return { corrupted: false };
  } catch (err) {
    let rawPreview = '';
    try {
      rawPreview = fs.readFileSync(filePath, 'utf-8').slice(0, 500);
    } catch { /* ignore */ }
    return {
      corrupted: true,
      error: err instanceof Error ? err.message : String(err),
      rawContent: rawPreview,
    };
  }
}

function isAbnormalNumber(value: number): boolean {
  return (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value === null ||
    value === undefined
  );
}

function createIssue(partial: Omit<HealthIssue, 'id'>): HealthIssue {
  const id = stableId(partial.type, partial.affectedId || partial.affectedType, String(partial.affectedName || ''));
  return {
    id,
    ...partial,
  };
}

function scanCorruptedJson(): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const storeTypes: StoreType[] = ['projects', 'variables', 'simulations', 'comparisons'];

  for (const type of storeTypes) {
    const result = checkFileCorruption(type);
    if (result.corrupted) {
      issues.push(createIssue({
        type: 'corrupted_json',
        severity: 'critical',
        title: 'JSON 文件损坏',
        description: `${FILES[type]} 文件无法解析，数据可能已损坏: ${result.error}`,
        affectedType: 'file',
        affectedId: type,
        affectedName: FILES[type],
        preview: {
          type,
          fileName: FILES[type],
          error: result.error,
          rawContentPreview: result.rawContent || '(无法读取)',
        },
        fixSuggestion: '建议从备份恢复该文件，或删除损坏文件让系统重建空数据（将丢失该文件中的所有数据）',
        canAutoFix: true,
      }));
    }
  }
  return issues;
}

function scanOrphanVariables(projects: Project[], variables: Variable[]): HealthIssue[] {
  const projectIds = new Set(projects.map(p => p.id));
  const issues: HealthIssue[] = [];

  for (const variable of variables) {
    if (!projectIds.has(variable.projectId)) {
      issues.push(createIssue({
        type: 'orphan_variable',
        severity: 'error',
        title: '孤儿变量',
        description: `变量 "${variable.name}" 引用的项目ID不存在`,
        affectedType: 'variable',
        affectedId: variable.id,
        affectedName: variable.name,
        preview: {
          id: variable.id,
          name: variable.name,
          projectId: variable.projectId,
          type: variable.type,
          createdAt: variable.createdAt,
        },
        fixSuggestion: '删除该孤儿变量',
        canAutoFix: true,
      }));
    }
  }
  return issues;
}

function scanOrphanSimulations(projects: Project[], simulations: SimulationResult[]): HealthIssue[] {
  const projectIds = new Set(projects.map(p => p.id));
  const issues: HealthIssue[] = [];

  for (const sim of simulations) {
    if (!projectIds.has(sim.projectId)) {
      issues.push(createIssue({
        type: 'orphan_simulation',
        severity: 'error',
        title: '孤儿模拟记录',
        description: `模拟记录 "${sim.runName}" 引用的项目ID不存在`,
        affectedType: 'simulation',
        affectedId: sim.id,
        affectedName: sim.runName,
        preview: {
          id: sim.id,
          runName: sim.runName,
          projectId: sim.projectId,
          iterations: sim.iterations,
          timestamp: sim.timestamp,
        },
        fixSuggestion: '删除该孤儿模拟记录',
        canAutoFix: true,
      }));
    }
  }
  return issues;
}

function scanOrphanComparisons(projects: Project[], comparisons: CompareRecord[]): HealthIssue[] {
  const projectIds = new Set(projects.map(p => p.id));
  const issues: HealthIssue[] = [];

  for (const compare of comparisons) {
    if (!projectIds.has(compare.projectId)) {
      issues.push(createIssue({
        type: 'orphan_compare',
        severity: 'error',
        title: '孤儿对比记录',
        description: `对比记录 "${compare.name}" 引用的项目ID不存在`,
        affectedType: 'compare',
        affectedId: compare.id,
        affectedName: compare.name,
        preview: {
          id: compare.id,
          name: compare.name,
          projectId: compare.projectId,
          simulationIds: compare.simulationIds,
          createdAt: compare.createdAt,
        },
        fixSuggestion: '删除该孤儿对比记录',
        canAutoFix: true,
      }));
    }
  }
  return issues;
}

function scanMissingProjects(projects: Project[], variables: Variable[], simulations: SimulationResult[], comparisons: CompareRecord[]): HealthIssue[] {
  const projectIds = new Set(projects.map(p => p.id));
  const issues: HealthIssue[] = [];

  const referencedProjectIds = new Map<string, { variables: string[]; simulations: string[]; comparisons: string[] }>();

  for (const v of variables) {
    if (!projectIds.has(v.projectId)) {
      if (!referencedProjectIds.has(v.projectId)) {
        referencedProjectIds.set(v.projectId, { variables: [], simulations: [], comparisons: [] });
      }
      referencedProjectIds.get(v.projectId)!.variables.push(v.name);
    }
  }
  for (const s of simulations) {
    if (!projectIds.has(s.projectId)) {
      if (!referencedProjectIds.has(s.projectId)) {
        referencedProjectIds.set(s.projectId, { variables: [], simulations: [], comparisons: [] });
      }
      referencedProjectIds.get(s.projectId)!.simulations.push(s.runName);
    }
  }
  for (const c of comparisons) {
    if (!projectIds.has(c.projectId)) {
      if (!referencedProjectIds.has(c.projectId)) {
        referencedProjectIds.set(c.projectId, { variables: [], simulations: [], comparisons: [] });
      }
      referencedProjectIds.get(c.projectId)!.comparisons.push(c.name);
    }
  }

  for (const [missingId, refs] of referencedProjectIds) {
    const details: string[] = [];
    if (refs.variables.length > 0) details.push(`${refs.variables.length} 个孤儿变量`);
    if (refs.simulations.length > 0) details.push(`${refs.simulations.length} 个孤儿模拟`);
    if (refs.comparisons.length > 0) details.push(`${refs.comparisons.length} 个孤儿对比`);

    issues.push(createIssue({
      type: 'missing_project',
      severity: 'error',
      title: '缺失项目',
      description: `项目ID ${missingId.slice(0, 8)}... 被引用但不存在，导致: ${details.join('、')}`,
      affectedType: 'project',
      affectedId: missingId,
      affectedName: `项目 ${missingId.slice(0, 8)}`,
      preview: {
        missingProjectId: missingId,
        orphanVariables: refs.variables,
        orphanSimulations: refs.simulations,
        orphanComparisons: refs.comparisons,
        totalAffected: refs.variables.length + refs.simulations.length + refs.comparisons.length,
      },
      fixSuggestion: '清理该缺失项目关联的所有孤儿变量、模拟和对比记录',
      canAutoFix: true,
    }));
  }

  return issues;
}

function scanMissingSimulations(simulations: SimulationResult[], comparisons: CompareRecord[]): HealthIssue[] {
  const simulationIds = new Set(simulations.map(s => s.id));
  const issues: HealthIssue[] = [];

  for (const compare of comparisons) {
    const missingIds = compare.simulationIds.filter(id => !simulationIds.has(id));
    if (missingIds.length > 0) {
      issues.push(createIssue({
        type: 'missing_simulation',
        severity: 'warning',
        title: '对比记录引用缺失的模拟',
        description: `对比记录 "${compare.name}" 引用的 ${missingIds.length} 个模拟记录不存在`,
        affectedType: 'compare',
        affectedId: compare.id,
        affectedName: compare.name,
        preview: {
          id: compare.id,
          name: compare.name,
          missingSimulationIds: missingIds,
          allSimulationIds: compare.simulationIds,
        },
        fixSuggestion: '从对比记录中移除缺失的模拟ID引用',
        canAutoFix: true,
      }));
    }
  }
  return issues;
}

function scanAbnormalValues(variables: Variable[], simulations: SimulationResult[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const variable of variables) {
    const problems: string[] = [];

    if (isAbnormalNumber(variable.min)) problems.push('最小值无效');
    if (isAbnormalNumber(variable.max)) problems.push('最大值无效');
    if (isAbnormalNumber(variable.mostLikely)) problems.push('最可能值无效');
    if (isAbnormalNumber(variable.weight)) problems.push('权重无效');

    if (!isAbnormalNumber(variable.min) && !isAbnormalNumber(variable.max) && variable.min >= variable.max) {
      problems.push('最小值大于等于最大值');
    }
    if (!isAbnormalNumber(variable.mostLikely) && !isAbnormalNumber(variable.min) && !isAbnormalNumber(variable.max)) {
      if (variable.mostLikely < variable.min || variable.mostLikely > variable.max) {
        problems.push('最可能值不在有效范围内');
      }
    }
    if (!isAbnormalNumber(variable.weight) && variable.weight <= 0) {
      problems.push('权重必须大于0');
    }

    if (problems.length > 0) {
      issues.push(createIssue({
        type: 'abnormal_value',
        severity: 'error',
        title: '变量数值异常',
        description: `变量 "${variable.name}" 存在以下问题: ${problems.join('、')}`,
        affectedType: 'variable',
        affectedId: variable.id,
        affectedName: variable.name,
        preview: {
          id: variable.id,
          name: variable.name,
          min: variable.min,
          max: variable.max,
          mostLikely: variable.mostLikely,
          weight: variable.weight,
          problems,
        },
        fixSuggestion: '编辑变量修正数值，或删除该变量',
        canAutoFix: false,
      }));
    }
  }

  for (const sim of simulations) {
    const problems: string[] = [];

    if (isAbnormalNumber(sim.mean)) problems.push('均值无效');
    if (isAbnormalNumber(sim.median)) problems.push('中位数无效');
    if (isAbnormalNumber(sim.stdDev)) problems.push('标准差无效');
    if (isAbnormalNumber(sim.min)) problems.push('最小值无效');
    if (isAbnormalNumber(sim.max)) problems.push('最大值无效');
    if (isAbnormalNumber(sim.lossProbability)) problems.push('损失概率无效');
    if (isAbnormalNumber(sim.var95)) problems.push('VaR95无效');

    if (!isAbnormalNumber(sim.lossProbability) && (sim.lossProbability < 0 || sim.lossProbability > 1)) {
      problems.push('损失概率超出0-1范围');
    }

    if (problems.length > 0) {
      issues.push(createIssue({
        type: 'abnormal_value',
        severity: 'warning',
        title: '模拟结果数值异常',
        description: `模拟 "${sim.runName}" 存在以下问题: ${problems.join('、')}`,
        affectedType: 'simulation',
        affectedId: sim.id,
        affectedName: sim.runName,
        preview: {
          id: sim.id,
          runName: sim.runName,
          mean: sim.mean,
          median: sim.median,
          stdDev: sim.stdDev,
          min: sim.min,
          max: sim.max,
          lossProbability: sim.lossProbability,
          var95: sim.var95,
          problems,
        },
        fixSuggestion: '删除该模拟记录并重新运行',
        canAutoFix: true,
      }));
    }

    if (sim.samples && sim.samples.length > MAX_SIMULATION_SAMPLES) {
      issues.push(createIssue({
        type: 'oversized_file',
        severity: 'warning',
        title: '模拟采样数据过大',
        description: `模拟 "${sim.runName}" 包含 ${sim.samples.length.toLocaleString()} 个采样点，建议清理`,
        affectedType: 'simulation',
        affectedId: sim.id,
        affectedName: sim.runName,
        preview: {
          id: sim.id,
          runName: sim.runName,
          samplesCount: sim.samples.length,
          hasVariableSamples: !!sim.variableSamples,
        },
        fixSuggestion: `清除采样数据（保留统计结果），超过 ${MAX_SIMULATION_SAMPLES.toLocaleString()} 个采样点`,
        canAutoFix: true,
      }));
    }
  }

  return issues;
}

function scanOversizedFiles(fileSizes: FileSizeInfo[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const file of fileSizes) {
    if (file.sizeMB > MAX_FILE_SIZE_MB) {
      issues.push(createIssue({
        type: 'oversized_file',
        severity: 'critical',
        title: '数据文件过大',
        description: `${FILES[file.type]} 文件大小为 ${file.sizeMB.toFixed(2)} MB，超过建议的 ${MAX_FILE_SIZE_MB} MB`,
        affectedType: 'file',
        affectedId: file.type,
        affectedName: FILES[file.type],
        preview: {
          type: file.type,
          path: file.path,
          sizeBytes: file.sizeBytes,
          sizeKB: file.sizeKB.toFixed(2),
          sizeMB: file.sizeMB.toFixed(2),
          recordCount: file.count,
        },
        fixSuggestion: '清理旧的模拟记录或删除不必要的采样数据',
        canAutoFix: false,
      }));
    }
  }

  return issues;
}

function runFullScan(): { result: HealthScanResult; issues: HealthIssue[]; projects: Project[]; variables: Variable[]; simulations: SimulationResult[]; comparisons: CompareRecord[] } {
  const corruptedIssues = scanCorruptedJson();

  const corruptedTypes = new Set(
    corruptedIssues.filter(i => i.type === 'corrupted_json').map(i => i.affectedId)
  );

  const projects: Project[] = corruptedTypes.has('projects') ? [] : projectsStore.getAll();
  const variables: Variable[] = corruptedTypes.has('variables') ? [] : variablesStore.getAll();
  const simulations: SimulationResult[] = corruptedTypes.has('simulations') ? [] : simulationsStore.getAll();
  const comparisons: CompareRecord[] = corruptedTypes.has('comparisons') ? [] : comparisonsStore.getAll();

  const dataCounts = {
    projects: projects.length,
    variables: variables.length,
    simulations: simulations.length,
    comparisons: comparisons.length,
  };

  const fileSizes: FileSizeInfo[] = [
    getFileSizeInfo('projects', projects.length),
    getFileSizeInfo('variables', variables.length),
    getFileSizeInfo('simulations', simulations.length),
    getFileSizeInfo('comparisons', comparisons.length),
  ];

  const issues: HealthIssue[] = [
    ...corruptedIssues,
    ...scanMissingProjects(projects, variables, simulations, comparisons),
    ...scanOrphanVariables(projects, variables),
    ...scanOrphanSimulations(projects, simulations),
    ...scanOrphanComparisons(projects, comparisons),
    ...scanMissingSimulations(simulations, comparisons),
    ...scanAbnormalValues(variables, simulations),
    ...scanOversizedFiles(fileSizes),
  ];

  const issuesBySeverity = {
    critical: issues.filter(i => i.severity === 'critical').length,
    error: issues.filter(i => i.severity === 'error').length,
    warning: issues.filter(i => i.severity === 'warning').length,
  };

  const result: HealthScanResult = {
    scannedAt: new Date().toISOString(),
    totalIssues: issues.length,
    issuesBySeverity,
    issues,
    fileSizes,
    dataCounts,
  };

  return { result, issues, projects, variables, simulations, comparisons };
}

router.get('/scan', (_req: Request, res: Response) => {
  const { result } = runFullScan();
  res.json(result);
});

router.post('/repair', (req: Request, res: Response) => {
  const dto = req.body as RepairRequest;
  if (!dto.issueIds || !Array.isArray(dto.issueIds)) {
    res.status(400).json({ error: 'issueIds 必须是数组' });
    return;
  }

  const scanRes = runFullScan();
  const issueMap = new Map(scanRes.issues.map(i => [i.id, i]));
  const repairResults: RepairResult['results'] = [];

  for (const issueId of dto.issueIds) {
    const issue = issueMap.get(issueId);
    if (!issue) {
      repairResults.push({
        issueId,
        success: false,
        message: '问题不存在或已修复',
      });
      continue;
    }

    if (!issue.canAutoFix) {
      repairResults.push({
        issueId,
        success: false,
        message: '该问题需要手动修复',
      });
      continue;
    }

    try {
      let message = '';

      switch (issue.type) {
        case 'corrupted_json':
          if (issue.affectedId) {
            const storeType = issue.affectedId as StoreType;
            const filePath = path.join(DATA_DIR, FILES[storeType]);
            if (fs.existsSync(filePath)) {
              const wrapper = {
                version: '1.0',
                lastModified: new Date().toISOString(),
                data: [] as unknown[],
              };
              fs.writeFileSync(filePath, JSON.stringify(wrapper, null, 2), 'utf-8');
              message = `已重置损坏的 ${FILES[storeType]} 为空数据文件`;
            }
          }
          break;
        case 'missing_project':
          if (issue.affectedId) {
            const missingProjectId = issue.affectedId;
            const delVars = variablesStore.deleteMany(v => v.projectId === missingProjectId);
            const delSims = simulationsStore.deleteMany(s => s.projectId === missingProjectId);
            const delComps = comparisonsStore.deleteMany(c => c.projectId === missingProjectId);
            message = `已清理缺失项目关联的 ${delVars} 个变量、${delSims} 个模拟、${delComps} 个对比`;
          }
          break;
        case 'orphan_variable':
          if (issue.affectedId) {
            variablesStore.delete(issue.affectedId);
            message = '已删除孤儿变量';
          }
          break;
        case 'orphan_simulation':
          if (issue.affectedId) {
            simulationsStore.delete(issue.affectedId);
            message = '已删除孤儿模拟记录';
          }
          break;
        case 'orphan_compare':
          if (issue.affectedId) {
            comparisonsStore.delete(issue.affectedId);
            message = '已删除孤儿对比记录';
          }
          break;
        case 'missing_simulation':
          if (issue.affectedId) {
            const compare = comparisonsStore.getById(issue.affectedId);
            if (compare) {
              const currentSims = simulationsStore.getAll();
              const simIds = new Set(currentSims.map(s => s.id));
              const validIds = compare.simulationIds.filter(id => simIds.has(id));
              comparisonsStore.update(issue.affectedId, { simulationIds: validIds });
              message = '已清理对比记录中缺失的模拟引用';
            }
          }
          break;
        case 'abnormal_value':
          if (issue.affectedType === 'simulation' && issue.affectedId) {
            simulationsStore.delete(issue.affectedId);
            message = '已删除异常的模拟记录';
          }
          break;
        case 'oversized_file':
          if (issue.affectedType === 'simulation' && issue.affectedId) {
            const sim = simulationsStore.getById(issue.affectedId);
            if (sim) {
              simulationsStore.update(issue.affectedId, {
                samples: undefined,
                variableSamples: undefined,
              } as Partial<SimulationResult>);
              message = '已清除模拟采样数据，保留统计结果';
            }
          }
          break;
      }

      repairResults.push({
        issueId,
        success: true,
        message,
      });
    } catch (error) {
      repairResults.push({
        issueId,
        success: false,
        message: error instanceof Error ? error.message : '修复失败',
      });
    }
  }

  const fixedCount = repairResults.filter(r => r.success).length;
  const failedCount = repairResults.filter(r => !r.success).length;

  const result: RepairResult = {
    success: failedCount === 0,
    fixedCount,
    failedCount,
    results: repairResults,
  };

  res.json(result);
});

export default router;
