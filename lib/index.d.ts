import type { Context } from 'koishi'
import type { Schema } from 'koishi'

export declare const name: string
export declare const inject: string[]
export declare const Config: Schema
export declare function apply(ctx: Context, config: Record<string, unknown>): void
export declare function synthesize(
  config: Record<string, unknown>,
  text: string
): Promise<{ buffer: Buffer; type: string }>
