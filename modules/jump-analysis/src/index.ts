import { requireNativeModule } from 'expo';
import type { DecodedAnalysis, JumpType } from '../../../src/core/measurement';
export type ImportedClip = { id: string; playbackFPS: number; duration: number; bytes: number; hasRetiming: boolean };
export type NativeAnalysis = DecodedAnalysis & { elapsedSeconds: number; decodedFrames: number; peakResidentBytes: number };
export type AnalysisReceipt = { id: string; analysis: NativeAnalysis; type: JumpType; fps: number; confirmed: boolean; ids: string[]; createdAt: string };
export default requireNativeModule<{
  pick(): Promise<ImportedClip | null>;
  analyze(id: string, originalFPS: number, type: string, confirmedOriginal: boolean, owner: string): Promise<AnalysisReceipt>;
  setAccount(owner: string | null): Promise<void>;
  recoverAnalysis(owner: string): Promise<AnalysisReceipt | null>;
  finishAnalysis(owner: string, id: string): Promise<void>;
  cancel(): void;
  discard(id: string): Promise<void>;
  evaluate(path: string, fps: number, type: string): Promise<NativeAnalysis>;
}>('JumpAnalysis');
