import type {LessonSource} from './curriculum';
export type LearningPhase = 'planning' | 'overview' | 'study' | 'verify' | 'teachback' | 'remediate' | 'complete';
export type HelpLevel = 'independent' | 'hinted' | 'explained';
export type EvidenceLevel = '待验证' | '初步理解' | '可独立应用' | '稳定掌握';
export type StepStatus = '未开始' | '学习中' | '待验证' | '已完成';

export interface LearningStep {
  id: string;
  title: string;
  outcome: string;
  priority: number;
  status: StepStatus;
}

export interface LearningPlan {
  target: string;
  steps: LearningStep[];
  confirmedAt?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  origin?: 'user' | 'assistant' | 'sandbox';
  model?: string;
  apiProfile?: string;
}

export interface Evidence {
  id: string;
  stepId: string;
  answer: string;
  teachback: string;
  helpLevel: HelpLevel;
  level: EvidenceLevel;
  confirmed: boolean;
  suggestion?: { level: EvidenceLevel; reason: string };
  gap?: string;
  gapAddressed?: boolean;
  createdAt: string;
}

export function proposeEvidence(column: LearningColumn, evidenceId: string, level: EvidenceLevel, reason: string, gap = ''): LearningColumn {
  const evidence = column.evidence.find(item => item.id === evidenceId);
  if (!evidence) throw new Error('找不到证据');
  if (!['待验证','初步理解','可独立应用','稳定掌握'].includes(level)) throw new Error('证据等级不正确');
  const safeLevel = level === '可独立应用' || level === '稳定掌握' ? '初步理解' : level;
  return { ...column, evidence: column.evidence.map(item => item.id === evidenceId ? { ...item, level: safeLevel, suggestion: { level: safeLevel, reason }, gap: gap.trim(), gapAddressed: !gap.trim(), confirmed: false } : item) };
}

export function addressGap(column: LearningColumn, evidenceId: string, addressed: boolean): LearningColumn {
  if (column.phase !== 'remediate') throw new Error('当前不是补缺阶段');
  return { ...column, evidence: column.evidence.map(item => item.id === evidenceId ? { ...item, gapAddressed: addressed || item.gapAddressed } : item) };
}

export interface LearningColumn {
  id: string;
  source?: LessonSource;
  kind?: 'knowledge' | 'project';
  title: string;
  goal: string;
  phase: LearningPhase;
  plan: LearningPlan | null;
  currentStepIndex: number;
  taughtStepIds: string[];
  pendingAnswer?: { text: string; helpLevel: HelpLevel; createdAt: string };
  messages: Message[];
  evidence: Evidence[];
  overview?: string;
  createdAt: string;
}

export function createColumn(title: string, goal: string, now: string, id: string = crypto.randomUUID(), kind: 'knowledge' | 'project' = 'knowledge'): LearningColumn {
  if (!title.trim() || !goal.trim()) throw new Error('栏目名称和目标不能为空');
  return { id, kind, title: title.trim(), goal: goal.trim(), phase: 'planning', plan: null, currentStepIndex: 0, taughtStepIds: [], messages: [], evidence: [], createdAt: now };
}

export function confirmPlan(column: LearningColumn, draft: { target: string; steps: Array<Omit<LearningStep, 'status'>> }, now = new Date().toISOString()): LearningColumn {
  if (column.phase !== 'planning') throw new Error('只能在规划阶段确认阶梯');
  if (!draft.target.trim() || draft.steps.length === 0 || draft.steps.some(step => !step.title.trim() || !step.outcome.trim())) throw new Error('阶梯需要目标和具体步骤');
  const steps = [...draft.steps].sort((a, b) => a.priority - b.priority).map((step, index) => ({ ...step, status: index === 0 ? '学习中' as const : '未开始' as const }));
  return { ...column, plan: { target: draft.target.trim(), steps, confirmedAt: now }, phase: 'overview', currentStepIndex: 0 };
}

export function beginStudy(column: LearningColumn): LearningColumn {
  if (column.phase !== 'overview' || !column.plan?.confirmedAt) throw new Error('先确认学习阶梯');
  return { ...column, phase: 'study' };
}

export function markTaught(column: LearningColumn): LearningColumn {
  if (column.phase !== 'study') throw new Error('当前不是学习阶段');
  const id = column.plan?.steps[column.currentStepIndex]?.id;
  if (!id) throw new Error('没有当前知识块');
  return { ...column, taughtStepIds: [...new Set([...column.taughtStepIds, id])] };
}

export function beginVerification(column: LearningColumn): LearningColumn {
  if (column.phase !== 'study') throw new Error('当前不是学习阶段');
  const id = column.plan?.steps[column.currentStepIndex]?.id;
  if (!id || !column.taughtStepIds.includes(id)) throw new Error('先学习当前知识块');
  return { ...column, phase: 'verify' };
}

export function recordAnswer(column: LearningColumn, answer: string, helpLevel: HelpLevel, now: string): LearningColumn {
  if (column.phase !== 'verify') throw new Error('当前不是学后验证阶段');
  if (!answer.trim()) throw new Error('回答不能为空');
  return { ...column, phase: 'teachback', pendingAnswer: { text: answer.trim(), helpLevel, createdAt: now } };
}

export function recordTeachback(column: LearningColumn, teachback: string, now: string): LearningColumn {
  if (column.phase !== 'teachback' || !column.pendingAnswer) throw new Error('先完成学后验证');
  if (!teachback.trim()) throw new Error('请先用自己的话复述');
  const stepId = column.plan?.steps[column.currentStepIndex]?.id;
  if (!stepId) throw new Error('没有当前知识块');
  const evidence: Evidence = {
    id: crypto.randomUUID(), stepId, answer: column.pendingAnswer.text,
    teachback: teachback.trim(), helpLevel: column.pendingAnswer.helpLevel,
    level: column.pendingAnswer.helpLevel === 'explained' ? '待验证' : '初步理解',
    confirmed: false, createdAt: now
  };
  return { ...column, evidence: [...column.evidence, evidence], pendingAnswer: undefined, phase: 'remediate' };
}

export function confirmEvidence(column: LearningColumn, evidenceId: string, level: EvidenceLevel): LearningColumn {
  const evidence = column.evidence.find(item => item.id === evidenceId);
  if (!evidence) throw new Error('找不到证据');
  if (level === '可独立应用' || level === '稳定掌握') throw new Error('文字回答只能确认初步理解；独立应用需实际运行，稳定表现需延迟变式证据');
  return { ...column, evidence: column.evidence.map(item => item.id === evidenceId ? { ...item, level, confirmed: true } : item) };
}

export function completeStep(column: LearningColumn): LearningColumn {
  if (column.phase !== 'remediate' || !column.plan) throw new Error('先完成复述与补缺');
  const current = column.plan.steps[column.currentStepIndex];
  const verified = column.evidence.some(item => item.stepId === current.id && item.confirmed && item.level !== '待验证' && item.gapAddressed !== false);
  if (!verified) throw new Error('先确认有证据的能力判断，或跳过并标为待验证');
  const nextIndex = column.currentStepIndex + 1;
  const steps = column.plan.steps.map((step, index) => ({ ...step, status: index === column.currentStepIndex ? '已完成' as const : index === nextIndex ? '学习中' as const : step.status }));
  return { ...column, plan: { ...column.plan, steps }, currentStepIndex: nextIndex, phase: nextIndex < steps.length ? (column.source ? 'study' : 'overview') : 'complete' };
}

export function skipStep(column: LearningColumn): LearningColumn {
  if (!column.plan || !['study', 'verify', 'teachback', 'remediate'].includes(column.phase)) throw new Error('当前知识块不能跳过');
  const nextIndex = column.currentStepIndex + 1;
  const steps = column.plan.steps.map((step, index) => ({ ...step, status: index === column.currentStepIndex ? '待验证' as const : index === nextIndex ? '学习中' as const : step.status }));
  return { ...column, plan: { ...column.plan, steps }, pendingAnswer: undefined, currentStepIndex: nextIndex, phase: nextIndex < steps.length ? (column.source ? 'study' : 'overview') : 'complete' };
}
