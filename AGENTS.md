# Agent Guidelines

## Mission

Expose Godot LSP diagnostics to MCP clients for GDScript validation.

## Scope

### In Scope

- Retrieve diagnostics from Godot's native LSP
- Cache and format diagnostic data for MCP clients
- Handle LSP connection lifecycle and reconnection

### Out of Scope

- Project manipulation (nodes, scenes, resources)
- Code generation or refactoring
- Asset management
- Build, export, or debugging beyond syntax errors

## Constraints

- **Native LSP only** - No custom Godot plugins
- **Minimal memory footprint** - Cache only what's needed
- **Fast diagnostic response** - Return cached data when possible
- **TypeScript strict mode** - No `any` types
- **Few runtime dependencies** - Keep the dependency tree small

## MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `get_diagnostics` | `{ file_path: string }` | Diagnostics for single file |
| `scan_workspace_diagnostics` | `{}` | Diagnostics for all `.gd` files |

See [README.md#mcp-tools](README.md#mcp-tools) for response schemas.
