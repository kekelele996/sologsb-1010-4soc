import { brailleText, inspectLine, syncContinuationMarkers, updateRuleInSet } from './braille';
import type { CorrectionRecord, ProofIssue, ProjectState, RuleSet, TextbookLine, TranscriptionRule } from './types';

export const CORRECTIONS_LIMIT = 50;

export const correctionId = () => `correction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface BatchFixPlan {
  ruleSetId: string;
  rule: TranscriptionRule;
  changes: CorrectionRecord['changes'];
  approvedResetCount: number;
  next: ProjectState;
}

/**
 * 纯函数：计算"停用某条规则并修正受影响行"的完整结果。
 * 不改变入参；只有盲文结果真正变化的行才会被更新，其他行（状态、备注、问题）原样保留。
 */
export function buildBatchFix(current: ProjectState, ruleId: string): BatchFixPlan | undefined {
  const ruleSet = current.ruleSets.find((set) => set.id === current.activeRuleSetId) ?? current.ruleSets[0];
  const rule = ruleSet.rules.find((item) => item.id === ruleId);
  if (!rule) return undefined;

  const beforeSet: RuleSet = ruleSet;
  const afterSet = updateRuleInSet(ruleSet, ruleId, { enabled: false });
  const changes: CorrectionRecord['changes'] = [];
  const afterCache = new Map<string, { line: TextbookLine; issues: ProofIssue[] }>();

  current.lines.forEach((line, index) => {
    const previous = current.lines[index - 1];
    const beforeLine = inspectLine(line, beforeSet, previous).line;
    const beforeBraille = brailleText(beforeLine.tokens);
    const afterInspection = inspectLine(line, afterSet, previous);
    afterCache.set(line.id, afterInspection);
    const afterBraille = brailleText(afterInspection.line.tokens);
    if (afterBraille === beforeBraille) return;

    const statusAfter = line.status === 'approved' ? 'questionable' : line.status;
    changes.push({
      lineId: line.id,
      index,
      source: line.source,
      brailleBefore: beforeBraille,
      brailleAfter: afterBraille,
      statusBefore: line.status,
      statusAfter,
      noteBefore: line.note,
      beforeTokens: beforeLine.tokens,
    });
  });

  const approvedResetCount = changes.filter((change) => change.statusBefore === 'approved').length;
  const changeById = new Map(changes.map((change) => [change.lineId, change]));
  const now = new Date().toISOString();
  const lines: TextbookLine[] = [];
  const issues: ProofIssue[] = [];

  current.lines.forEach((line) => {
    const change = changeById.get(line.id);
    if (!change) {
      // 未变化行：状态、备注、问题一律保留，仅清理仍指向已停用规则的未处理问题。
      lines.push(line);
      issues.push(...current.issues.filter((item) => item.lineId === line.id && !(item.ruleId === ruleId && !item.resolved)));
      return;
    }
    const inspected = afterCache.get(line.id)!;
    lines.push({ ...inspected.line, status: change.statusAfter, note: line.note });
    issues.push(...inspected.issues);
  });

  const next: ProjectState = {
    ...current,
    ruleSets: current.ruleSets.map((set) => (set.id === afterSet.id ? afterSet : set)),
    lines,
    issues,
    lastCheckedAt: now,
    updatedAt: now,
  };

  return { ruleSetId: ruleSet.id, rule, changes, approvedResetCount, next };
}

/** 恢复某次修正：重新启用规则，把受影响行还原到修正前内容（之后删除的行会插回原位）。 */
export function restoreCorrection(current: ProjectState, record: CorrectionRecord): ProjectState {
  const now = new Date().toISOString();
  const ruleSets = current.ruleSets.map((set) => (
    set.id === record.ruleSetId
      ? { ...set, rules: set.rules.map((item) => (item.id === record.ruleId ? { ...item, enabled: true } : item)) }
      : set
  ));
  const restoredSet = ruleSets.find((set) => set.id === record.ruleSetId);
  const ruleStillExists = Boolean(restoredSet?.rules.some((item) => item.id === record.ruleId));

  const working = current.lines.map((line) => ({ line, restored: false }));

  for (const change of [...record.changes].sort((a, b) => b.index - a.index)) {
    const atIndex = working[change.index];
    if (atIndex && atIndex.line.id === change.lineId) {
      atIndex.line = { ...atIndex.line, source: change.source, note: change.noteBefore, status: change.statusBefore };
      atIndex.restored = true;
      continue;
    }
    const existing = working.find((entry) => entry.line.id === change.lineId);
    if (existing) {
      existing.line = { ...existing.line, source: change.source, note: change.noteBefore, status: change.statusBefore };
      existing.restored = true;
      continue;
    }
    const insertAt = Math.min(change.index, working.length);
    working.splice(insertAt, 0, {
      line: { id: change.lineId, source: change.source, tokens: change.beforeTokens, status: change.statusBefore, note: change.noteBefore, continuesPrevious: false, continuesNext: false },
      restored: true,
    });
  }

  // 基于最新邻接关系统一同步跨行标记。
  const markerSynced = syncContinuationMarkers(working.map((entry) => entry.line));
  const effectiveSet = restoredSet
    ?? current.ruleSets.find((set) => set.id === current.activeRuleSetId)
    ?? current.ruleSets[0];

  const lines: TextbookLine[] = [];
  const issues: ProofIssue[] = [];
  markerSynced.forEach((line, index) => {
    const restored = working[index].restored;
    const previous = markerSynced[index - 1];
    if (!restored) {
      const original = current.lines.find((item) => item.id === line.id);
      const markerChanged = Boolean(original && (original.tokens[0]?.braille === '↳ ') !== (line.tokens[0]?.braille === '↳ '));
      if (original && !markerChanged) {
        lines.push(original);
        issues.push(...current.issues.filter((item) => item.lineId === line.id));
        return;
      }
      const inspected = inspectLine(line, effectiveSet, previous);
      lines.push({ ...inspected.line, status: original?.status ?? line.status, note: original?.note ?? line.note });
      issues.push(...inspected.issues);
      return;
    }

    // 规则仍在时按还原后的规则重新转录，确保盲文正是"修正前"的内容；规则已被删除则回退保存的旧 token。
    const inspected = ruleStillExists
      ? inspectLine(line, effectiveSet, previous)
      : { line: { ...line, tokens: line.tokens }, issues: [] as ProofIssue[] };
    lines.push({ ...inspected.line, status: line.status, note: line.note, continuesPrevious: line.continuesPrevious, continuesNext: line.continuesNext });
    issues.push(...inspected.issues);
  });

  const corrections = current.corrections.map((item) => (
    item.id === record.id ? { ...item, restored: true, restoredAt: now } : item
  ));

  return { ...current, ruleSets, lines, issues, corrections, lastCheckedAt: now, updatedAt: now };
}

/** 恢复旧版本快照时保留当前的修正记录（按 id 合并去重）。 */
export function mergeCorrections(restored: CorrectionRecord[], incoming: CorrectionRecord[]): CorrectionRecord[] {
  const seen = new Set<string>();
  const merged: CorrectionRecord[] = [];
  [...restored, ...incoming].forEach((record) => {
    if (seen.has(record.id)) return;
    seen.add(record.id);
    merged.push(record);
  });
  return merged.slice(0, CORRECTIONS_LIMIT);
}
