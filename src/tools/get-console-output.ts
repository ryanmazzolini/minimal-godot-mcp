import { ConsoleManager, ConsoleOutputFilter } from '../console-manager.js';
import { NO_DEBUG_SESSION_ERROR } from '../errors.js';
import { ConsoleOutput, DAPOutputCategory } from '../types.js';

export interface GetConsoleOutputInput {
  limit?: number;
  category?: DAPOutputCategory;
  since?: number;
}

export interface GetConsoleOutputOutput {
  entries: ConsoleOutput[];
  total_buffered: number;
  error?: string;
}

/**
 * Get console output from Godot DAP
 */
export function getConsoleOutput(
  consoleManager: ConsoleManager,
  isDAPConnected: boolean,
  input: GetConsoleOutputInput
): GetConsoleOutputOutput {
  if (!isDAPConnected) {
    return {
      entries: [],
      total_buffered: 0,
      error: NO_DEBUG_SESSION_ERROR,
    };
  }

  // Validate category if provided
  const validCategories: DAPOutputCategory[] = ['console', 'stdout', 'stderr'];
  if (input.category && !validCategories.includes(input.category)) {
    throw new Error(`Invalid category: ${input.category}. Must be one of: ${validCategories.join(', ')}`);
  }

  // Validate limit if provided
  if (input.limit !== undefined && (typeof input.limit !== 'number' || input.limit < 0)) {
    throw new Error('limit must be a non-negative number');
  }

  // Validate since if provided
  if (input.since !== undefined && (typeof input.since !== 'number' || input.since < 0)) {
    throw new Error('since must be a non-negative timestamp');
  }

  const filter: ConsoleOutputFilter = {
    limit: input.limit,
    category: input.category,
    since: input.since,
  };

  const entries = consoleManager.getOutput(filter);
  const totalBuffered = consoleManager.size();

  return {
    entries,
    total_buffered: totalBuffered,
  };
}

/**
 * Tool schema for MCP
 */
export const getConsoleOutputTool = {
  name: 'get_console_output',
  description:
    'Get console output from Godot debug session. ' +
    'Returns print() statements, errors, and warnings captured during scene execution. ' +
    'Requires an active debug session (run a scene with F5 in Godot). ' +
    'Use to debug runtime behavior, check print output, or monitor warnings.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of entries to return (most recent). Default: all buffered.',
      },
      category: {
        type: 'string',
        enum: ['console', 'stdout', 'stderr'],
        description: 'Filter by output category. console=print(), stdout=standard out, stderr=errors.',
      },
      since: {
        type: 'number',
        description: 'Unix timestamp (ms). Only return entries after this time.',
      },
    },
    required: [],
  },
};
