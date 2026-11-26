import type { Context } from 'koishi'
import type { Schema } from 'koishi'

export type FoxyEmotion =
  | 'neutral'
  | 'happy'
  | 'gentle'
  | 'affectionate'
  | 'shy'
  | 'sad'
  | 'angry'
  | 'serious'

export interface FoxyTtsResult {
  buffer: Buffer
  type: string
  provider: 'gpt-sovits' | 'azure'
  emotion: FoxyEmotion
  reference?: string
  fallbackFrom?: string
  warning?: string
}

export declare const name: string
export declare const inject: string[]
export declare const Config: Schema
export declare const EMOTIONS: FoxyEmotion[]
export declare function apply(ctx: Context, config: Record<string, unknown>): void
export declare function synthesize(
  config: Record<string, unknown>,
  text: string,
  emotion?: FoxyEmotion | string
): Promise<FoxyTtsResult>
export declare function synthesizeGptSoVits(
  config: Record<string, unknown>,
  text: string,
  emotion?: string
): Promise<FoxyTtsResult>
export declare function synthesizeAzure(
  config: Record<string, unknown>,
  text: string,
  emotion?: string
): Promise<FoxyTtsResult>
export declare function buildAzureSsml(
  config: Record<string, unknown>,
  text: string,
  emotion?: string
): string
export declare function detectEmotion(text: string, fallback?: string): FoxyEmotion
export declare function normalizeEmotion(value: string): FoxyEmotion | ''
export declare function createToolClass(
  config: Record<string, unknown>,
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void }
): new () => unknown
