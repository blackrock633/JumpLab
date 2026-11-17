import { requireNativeModule } from 'expo';
import type { Evidence } from '../../../src/core/measurement';
export type ImportedClip = { id: string; playbackFPS: number; duration: number; bytes: number; hasRetiming: boolean };
export type NativeAnalysis = { timestamps: number[]; events: Evidence[]; elapsedSeconds: number; decodedFrames: number; peakResidentBytes: number };
export default requireNativeModule<{
  pick(): Promise<ImportedClip | null>;
  analyze(id: string, originalFPS: number, type: string, confirmedOriginal: boolean): Promise<NativeAnalysis>;
  cancel(): void;
  discard(id: string): Promise<void>;
  evaluate(path: string, fps: number, type: string): Promise<NativeAnalysis>;
}>('JumpAnalysis');
