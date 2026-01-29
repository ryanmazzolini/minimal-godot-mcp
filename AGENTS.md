# Agent Guidelines

## Project Vision

**See [README.md#vision](README.md#vision) for complete project goals.**

**Core mission:** Expose Godot LSP diagnostics to MCP clients for real-time GDScript syntax validation.

## Scope Boundaries

### ✅ In Scope
- Retrieve diagnostics from Godot's native LSP (port 6007)
- Cache and format diagnostic data for MCP clients
- Handle LSP connection lifecycle/reconnection

### ❌ Out of Scope
- Project manipulation (nodes/scenes/resources)
- Code generation/refactoring
- Asset management
- Build/export/debugging beyond syntax errors

**When evaluating features, refer to [README.md#vision](README.md#vision).**

## Architecture Constraints

- Use Godot's **native LSP** - NO custom Godot plugins
- Target <200 LOC core implementation
- Maintain <10MB memory footprint
- Return diagnostics <1s after LSP update

## Implementation Standards

- TypeScript strict mode - **NO `any` types**
- Minimal dependencies (<5 npm packages)
- Self-documenting code > comments
- Cache-first diagnostic strategy

## MCP Tool: `get_diagnostics`

Check GDScript files for errors after editing or when analyzing code. Returns syntax errors, type errors, undefined variables, missing functions, and code quality issues from Godot LSP (<1s).

**Input:** `{ file_path: string }` (absolute path to .gd file)

**Output:**
```typescript
{
  diagnostics: Array<{
    line: number
    column: number
    severity: 'error' | 'warning' | 'info'
    message: string
    code?: string
  }>
}
```

**Behavior:**
- Empty array if file not in Godot project
- Error if Godot LSP unreachable
- 5s timeout, return cached if available

## Development Flow

1. **Research**: Review [README.md](README.md) for context
2. **Validate scope**: Ensure changes align with vision
3. **Implement**: Follow architecture constraints
4. **Test**: Verify against real Godot editor

**Simplicity over features.** Every addition must justify its existence for diagnostic retrieval.
