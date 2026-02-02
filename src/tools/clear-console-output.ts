import { ConsoleManager } from '../console-manager.js';

export interface ClearConsoleOutputOutput {
  cleared: boolean;
}

/**
 * Clear console output buffer
 */
export function clearConsoleOutput(
  consoleManager: ConsoleManager
): ClearConsoleOutputOutput {
  consoleManager.clear();

  return {
    cleared: true,
  };
}

/**
 * Tool schema for MCP
 */
export const clearConsoleOutputTool = {
  name: 'clear_console_output',
  description:
    'Clear the console output buffer. ' +
    'Use to reset output collection before running a specific test or action.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};
