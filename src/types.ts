export type Engine = 'chrome' | 'lightpanda';
export type Provider = 'local' | 'browserbase' | 'browserless' | 'steel' | 'browser-use' | 'brightdata' | 'hyperbrowser' | 'anchor';
export interface Target { id: string; provider: Provider; engine: Engine; region?: string }
export type Status = 'pass' | 'fail' | 'error' | 'timeout' | 'unsupported' | 'cancelled';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Field { selector?: string; kind?: 'text' | 'value' | 'attribute'; attribute?: string }
export type Step =
  | { action: 'open'; url: string }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value?: string; env?: string }
  | { action: 'wait'; selector: string }
  | { action: 'extract'; as: string; selector: string; kind: 'text' | 'texts' | 'count' | 'value' | 'attribute' | 'table'; attribute?: string; fields?: Record<string, Field> }
  | { action: 'screenshot'; name: string };
export type Operator = 'required' | 'equals' | 'contains' | 'count' | 'min' | 'max' | 'type' | 'unique';
export interface Rule { op: Operator; value?: Json; field?: string }
export interface Assertion extends Omit<Rule, 'op'> { path: string; op: Operator | 'every'; rule?: Rule }
export interface TestCase {
  id: string; name: string; steps: Step[]; assertions: Assertion[];
  timeoutMs?: number; retries?: number; expectedStatus?: Exclude<Status, 'cancelled'>;
}
interface SuiteCommon { name: string; repetitions: number; timeoutMs: number; tests: TestCase[] }
export interface LegacySuite extends SuiteCommon { version: 1; engines: Engine[] }
export interface TargetSuite extends SuiteCommon { version: 2; targets: Target[] }
export type Suite = LegacySuite | TargetSuite;
export interface AssertionResult { path: string; op: string; passed: boolean; message: string }
export interface StepResult { index: number; action: string; durationMs: number; error?: string }
export interface Trial {
  id: string; testId: string; testName: string; engine: Engine; targetId?: string; costUsd?: null; remoteSessionId?: string; repetition: number; attempt: number;
  expectedStatus: Status; status: Status; matchedExpectation: boolean; startedAt: string;
  durationMs: number; startupMs: number; workflowMs: number;
  peakRssKb: number | null; cpuMs: number | null; measurementMethod: string;
  steps: StepResult[]; assertions: AssertionResult[]; output: Record<string, Json>;
  failurePhase?: 'setup' | 'workflow'; error?: string; cleanupError?: string; cleanupMethod?: 'graceful' | 'forced' | 'provider-confirmed' | 'cdp-confirmed' | 'not-created'; artifacts: string[];
}
export interface Run {
  version: 1 | 2; id: string; suiteName: string; suiteHash: string; createdAt: string;
  configurations: { id?: string; provider?: Provider; engine: Engine; region?: string; version: string | null; proxy?: false | 'provider-managed'; stealth?: false | 'provider-managed'; settingsVersion?: number; regionPolicy?: 'requested' | 'local' | 'provider-managed'; sessionTimeout?: 'local' | 'requested' | 'client-only' }[];
  host: { platform: string; arch: string; release: string; cpus: number; memoryBytes: number; node: string };
  adapterVersion: string; repetitions: number; trials: Trial[]; interrupted: boolean;
  testCases: { id: string; expectedStatus: Status }[];
}
export interface Finding { severity: 'regression' | 'warning'; testId: string; engine: Engine; targetId?: string; message: string }
export interface Comparison { baselineId: string; compatible: boolean; findings: Finding[] }
