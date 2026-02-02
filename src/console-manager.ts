import { ConsoleOutput, DAPOutputCategory, DAPOutputEventBody } from './types.js';

/**
 * Filter options for retrieving console output
 */
export interface ConsoleOutputFilter {
  limit?: number;
  category?: DAPOutputCategory;
  since?: number;
}

/**
 * Manages console output from Godot DAP with a bounded circular buffer
 */
export class ConsoleManager {
  private buffer: ConsoleOutput[] = [];
  private readonly maxSize: number;

  constructor(maxSize?: number) {
    const envSize = process.env.GODOT_DAP_BUFFER_SIZE;
    if (envSize !== undefined && envSize !== '') {
      const size = parseInt(envSize, 10);
      if (!isNaN(size) && size > 0) {
        this.maxSize = size;
      } else {
        this.maxSize = 1000;
      }
    } else {
      this.maxSize = maxSize ?? 1000;
    }
  }

  /**
   * Add output event to buffer
   */
  addOutput(event: DAPOutputEventBody): void {
    const entry: ConsoleOutput = {
      timestamp: Date.now(),
      category: event.category,
      message: event.output,
      source: event.source?.path ?? event.source?.name,
      line: event.line,
    };

    this.buffer.push(entry);

    // Drop oldest entries if buffer exceeds max size
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get output entries with optional filtering
   */
  getOutput(options?: ConsoleOutputFilter): ConsoleOutput[] {
    let result = this.buffer;

    // Filter by category
    if (options?.category) {
      result = result.filter((entry) => entry.category === options.category);
    }

    // Filter by timestamp
    if (options?.since !== undefined && options.since > 0) {
      const since = options.since;
      result = result.filter((entry) => entry.timestamp >= since);
    }

    // Apply limit (from end of array - most recent)
    if (options?.limit !== undefined && options.limit > 0) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * Clear all output from buffer
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Get current buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Get max buffer size
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}
