# minimal-godot-mcp

Minimal MCP server for real-time GDScript syntax validation via Godot's native Language Server Protocol (LSP).

## Vision

### Problem
When using AI coding assistants to edit GDScript files, there's no real-time feedback on syntax errors. 
Developers need to switch to the Godot editor to validate changes, breaking flow.

### Solution
A lightweight bridge between MCP clients and Godot's built-in Language Server Protocol. No custom plugins, no extra dependencies—just instant syntax feedback by tapping into what's already running.

**Design philosophy:**
- **Code-focused**: Help with GDScript editing, not scene/project manipulation
- **Minimal dependencies**: Uses Godot's native LSP — nothing extra to install
- **Low context overhead**: Lightweight tool responses to minimize token usage
- **Plays nice**: Compatible with existing tools like godot-vscode-plugin

See the context use according to claude-code `/context`:

![context-use](docs/context-use.png)

### Differentiators

| Feature | godot-server-mcp | ee0pdt/Godot-MCP | Coding-Solo/godot-mcp |
|---------|------------------|------------------|----------------------|
| Custom plugin required | ❌ | ✅ | ❌ |
| Project manipulation | ❌ | ✅ | ✅ |
| LSP integration | ✅ Native | ❌ Custom | ❌ GDScript ops |
| Scope | Diagnostics only | Full control | CLI + scripts |

## Installation

### Prerequisites
- Node.js 24+
- Godot 3.2+ or 4.x with LSP enabled

### Setup

```bash
npm install -g godot-server-mcp
```

Configure your MCP client (Claude Desktop, Cline, etc.):

```json
{
  "mcpServers": {
    "godot": {
      "command": "godot-server-mcp"
    }
  }
}
```

**Environment variables** (optional):
```json
{
  "mcpServers": {
    "godot": {
      "command": "godot-server-mcp",
      "env": {
        "GODOT_LSP_PORT": "6005",
        "GODOT_WORKSPACE_PATH": "/absolute/path/to/your/godot/project"
      }
    }
  }
}
```

- `GODOT_LSP_PORT`: Override default port selection (default: tries 6007, 6005, 6008)
- `GODOT_WORKSPACE_PATH`: Set Godot project path for LSP initialization (default: uses workspace from Godot's notification)

### Claude Code Configuration

For Claude Code, add to `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/path/to/godot-server-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code after modifying the config.

## Usage

1. Start Godot editor with your project
2. Verify LSP is running: `nc -zv localhost 6007`
3. Edit GDScript files with your MCP client enabled
4. Receive instant syntax error feedback

### MCP Tools

#### `get_diagnostics`

Fast single-file diagnostic check (<1s).

**Input:**
```json
{
  "file_path": "/absolute/path/to/script.gd"
}
```

**Output:**
```json
{
  "diagnostics": {
    "/path/to/file1.gd": [
      {
        "line": 42,
        "column": 10,
        "severity": "error",
        "message": "Expected identifier after '.'",
        "code": "GD0001"
      }
    ]
  }
}
```

#### `scan_workspace_diagnostics`

⚠️ **EXPENSIVE** operation - scans ALL `.gd` files in workspace (5-30s for 100+ files).

Use sparingly for workspace-wide error checking. Requires `GODOT_WORKSPACE_PATH` environment variable.

**Input:**
```json
{}
```

**Output:**
```json
{
  "files_scanned": 150,
  "files_with_issues": 3,
  "scan_time_seconds": 12.45,
  "diagnostics": {
    "/path/to/file1.gd": [...],
    "/path/to/file2.gd": [...]
  }
}
```

## Development

### Quick Start

```bash
git clone https://github.com/yourusername/godot-server-mcp.git
cd godot-server-mcp
npm install
npm run build
npm run dev
```

### Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌────────────┐
│ MCP Client  │ ◄─MCP──► │ godot-server-mcp │ ◄─LSP──► │   Godot    │
│             │         │   (TypeScript)   │         │   Editor   │
└─────────────┘         └──────────────────┘         └────────────┘
```

**LSP Communication:**
1. Connect to `localhost:6007` via TCP
2. Send LSP `initialize` request
3. Sync documents with `textDocument/didOpen`
4. Receive `textDocument/publishDiagnostics` notifications
5. Cache and serve via MCP `get_diagnostics` tool

### Project Structure

```
godot-server-mcp/
├── src/
│   ├── index.ts              # MCP server entry
│   ├── lsp-client.ts         # LSP connection handler
│   ├── diagnostics.ts        # Caching/formatting
│   └── tools/
│       └── get-diagnostics.ts
├── AGENTS.md -> CLAUDE.md    # AI agent guidelines
├── README.md
├── package.json
└── LICENSE
```

### Testing

```bash
npm test          # Unit tests
npm run lint      # ESLint + Prettier
```

**Manual testing:**
1. Start Godot with test project
2. Run `npm run dev`
3. Configure MCP client
4. Introduce syntax error in .gd file
5. Verify diagnostic appears

### Contributing

Contributions welcome! See [Development](#development) for setup instructions.

Before submitting a PR:
- Run `npm run format`
- Add tests for new functionality
- Verify changes work with a real Godot project

This project focuses on providing GDScript diagnostics via Godot's LSP - keep contributions aligned with that goal.

## Troubleshooting

**"Connection refused on port 6007"**
- Godot editor not running
- LSP disabled in project settings
- Firewall blocking localhost

**"No diagnostics returned"**
- File not part of Godot project
- File not opened in editor (LSP needs context)
- Syntax is actually valid

**"Stale diagnostics"**
- Cache not invalidating on file changes
- LSP not sending update notifications

### Enable LSP Debug Logs

In Godot: `Project → Project Settings → Network → Language Server → Log`

## License

See [LICENSE](LICENSE)
