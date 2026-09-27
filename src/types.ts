export type RuleKind = 'letter' | 'number' | 'punctuation' | 'contraction' | 'special';
export type LineStatus = 'unchecked' | 'reviewed' | 'questionable' | 'approved';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface TranscriptionRule {
  id: string;
  source: string;
  output: string;
  kind: RuleKind;
  enabled: boolean;
  suspicious: boolean;
  description: string;
}

export interface RuleSet {
  id: string;
  name: string;
  description: string;
  contractions: boolean;
  hyphenMode: 'cross-line' | 'inline';
  rules: TranscriptionRule[];
}

export interface BrailleToken {
  id: string;
  text: string;
  braille: string;
  kind: RuleKind;
  ruleId?: string;
  suspicious: boolean;
  offset: number;
}

export interface TextbookLine {
  id: string;
  source: string;
  tokens: BrailleToken[];
  status: LineStatus;
  note: string;
  continuesPrevious: boolean;
  continuesNext: boolean;
}

export interface ProofIssue {
  id: string;
  lineId: string;
  tokenId?: string;
  ruleId?: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  resolved: boolean;
}

/** 不含历史记录的正文快照，供版本与批量修正留档使用。 */
export type ProjectSnapshot = Omit<ProjectState, 'versions' | 'corrections'>;

export interface VersionSnapshot {
  id: string;
  name: string;
  createdAt: string;
  action: string;
  snapshot: ProjectSnapshot;
}

/** 批量停用规则时，单条课文行的修正前后对照。 */
export interface BatchFixLineChange {
  lineId: string;
  lineNumber: number;
  source: string;
  brailleBefore: string;
  brailleAfter: string;
  statusBefore: LineStatus;
  statusAfter: LineStatus;
}

/** 一次“停用规则并批量修正”的可回看记录，可整体恢复当时内容。 */
export interface CorrectionRecord {
  id: string;
  createdAt: string;
  ruleId: string;
  ruleSource: string;
  ruleOutput: string;
  ruleSetId: string;
  changedLineCount: number;
  resetApprovedCount: number;
  changes: BatchFixLineChange[];
  before: ProjectSnapshot;
}

export interface ProjectState {
  id: string;
  title: string;
  author: string;
  activeRuleSetId: string;
  ruleSets: RuleSet[];
  lines: TextbookLine[];
  selectedLineId: string;
  issues: ProofIssue[];
  versions: VersionSnapshot[];
  corrections: CorrectionRecord[];
  lastCheckedAt: string;
  updatedAt: string;
}

export interface HistoryState {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
  lastAction: string;
}
