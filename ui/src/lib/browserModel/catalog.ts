import type { ToolFormat } from './toolFormats';

export interface BrowserModelSpec {
  /** Stored in Settings.model. */
  key: string;
  label: string;
  /** Hugging Face repo holding the ONNX export. */
  repo: string;
  dtype: 'q4';
  format: ToolFormat;
  /** Download size of the quantized weights. */
  downloadMb: number;
  /** Largest prompt the model accepts. */
  contextTokens: number;
  note: string;
}

// Only models that write tool calls (the app cannot work without them) and download in a few hundred MB. Each was run
// against the live EvalHub tool list before being listed. Left out: FunctionGemma 270M (425 to 800 MB, asked a question
// instead of calling the tool) and LFM2 350M (same behaviour as LFM2.5).
export const BROWSER_MODELS: readonly BrowserModelSpec[] = [
  {
    key: 'qwen3.5-0.8b', label: 'Qwen3.5 0.8B (Alibaba)', repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX', dtype: 'q4', format: 'qwen',
    downloadMb: 570, contextTokens: 32768, note: 'Calls design_collection correctly on the example goals. Larger download, slower than the 350M model.',
  },
  {
    key: 'lfm2.5-350m', label: 'LFM2.5 350M (Liquid AI)', repo: 'onnx-community/LFM2.5-350M-ONNX', dtype: 'q4', format: 'lfm2',
    downloadMb: 294, contextTokens: 32768, note: 'Smallest and fastest, but often answers that it has no suitable tool instead of calling one, and invents arguments.',
  },
];

export const DEFAULT_BROWSER_MODEL = 'qwen3.5-0.8b';

export const findBrowserModel = (key: string): BrowserModelSpec | undefined => BROWSER_MODELS.find((m) => m.key === key);
