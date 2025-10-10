# minimal-godot-mcp

> Lightweight MCP server bridging Godot LSP to MCP clients for GDScript validation

[![npm version](https://img.shields.io/npm/v/minimal-godot-mcp.svg)](https://www.npmjs.com/package/minimal-godot-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)

Built with one mission: surface Godot diagnostics with minimal overhead.

Get instant GDScript syntax feedback in Claude, Cursor, and other MCP clients—no context switching to Godot, no custom plugins. Just a lightweight bridge to Godot's native LSP.

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Usage](#usage)
- [Comparison](#comparison)
- [Development](#development)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [Related Projects](#related-projects)
- [License](#license)

## Quick Start

### Prerequisites

- Node.js 24+
- Godot 3.2+ or 4.x with LSP enabled

### Setup

> **Note:** Package not yet published to npm. For now, clone and build locally.

```bash
# Clone and build
git clone https://github.com/ryanmazzolini/minimal-godot-mcp.git
cd minimal-godot-mcp
npm install
npm run build

# Start Godot editor with your project
```

Configure your MCP client (eg. Claude Code) to use the local build:

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/path/to/minimal-godot-mcp/dist/index.js"]
    }
  }
}
```

> **Tip:** See [Configuration](#configuration) for environment variables and client-specific examples.

Restart your MCP client and start editing `.gd` files ✨

## Features

- **🔌 Zero-config LSP integration** - Uses Godot's native Language Server (no plugins, no extra
  dependencies)
- **⚡ Fast diagnostics** - Single-file checks return in <1s
- **📦 Minimal footprint** - <10MB memory, <200 LOC core implementation
- **💬 Low context overhead** - Lightweight responses to minimize AI token usage
- **🔄 Resilient connections** - Handles Godot restarts and reconnections automatically
- **🤝 Plays nice** - Compatible with godot-vscode-plugin and other LSP clients
- **🌐 Workspace scanning** - Optional bulk checking of all `.gd` files

See the context usage in Claude Code:

![context-use](docs/context-use.png)

## Configuration

### Environment Variables

Set these environment variables in your MCP client configuration to customize behavior:

- **`GODOT_LSP_PORT`**: Override default port selection
  Default: tries ports 6007, 6005, 6008 in order
  Example: `"GODOT_LSP_PORT": "6005"`

- **`GODOT_WORKSPACE_PATH`**: Set Godot project path for LSP initialization
  Default: uses workspace from Godot's notification
  Example: `"GODOT_WORKSPACE_PATH": "/absolute/path/to/your/godot/project"`

### MCP Client Examples

**Claude Code** (`~/.claude/config.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/path/to/minimal-godot-mcp/dist/index.js"],
      "env": {
        "GODOT_LSP_PORT": "6007",
        "GODOT_WORKSPACE_PATH": "/absolute/path/to/your/godot/project"
      }
    }
  }
}
```

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

Use sparingly for workspace-wide error checking. Requires `GODOT_WORKSPACE_PATH` environment
variable.

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

**Example in practice:**

When you edit a GDScript file with a syntax error:

```gdscript
# player.gd
extends CharacterBody2D

func _ready():
    velocity. = Vector2(100, 0)  # Missing identifier after '.'
```

The MCP client receives:

```json
{
  "diagnostics": {
    "/path/to/player.gd": [
      {
        "line": 5,
        "column": 14,
        "severity": "error",
        "message": "Expected identifier after '.'",
        "code": "parse-error"
      }
    ]
  }
}
```

## Comparison

How minimal-godot-mcp differs from other Godot MCP servers:

| Feature                | minimal-godot-mcp | ee0pdt/Godot-MCP | Coding-Solo/godot-mcp |
|------------------------|-------------------|------------------|-----------------------|
| Custom plugin required | ❌                 | ✅                | ❌                     |
| Project manipulation   | ❌                 | ✅                | ✅                     |
| LSP integration        | ✅ Native          | ❌ Custom         | ❌ GDScript ops        |
| Scope                  | Diagnostics only  | Full control     | CLI + scripts         |

**Use minimal-godot-mcp when:** You want lightweight syntax checking during AI-assisted GDScript
editing

**Use alternatives when:** You need scene management, node creation, or full project control

## Development

### Architecture

```
┌─────────────┐         ┌────────────────────┐         ┌────────────┐
│ MCP Client  │ ◄─MCP─► │ minimal-godot-mcp  │ ◄─LSP─► │   Godot    │
│             │         │   (TypeScript)     │         │   Editor   │
└─────────────┘         └────────────────────┘         └────────────┘
```

**LSP Communication:**

1. Connect to Godot LSP via TCP (tries `localhost` ports 6007, 6005, 6008)
2. Send LSP `initialize` request
3. Sync documents with `textDocument/didOpen`
4. Receive `textDocument/publishDiagnostics` notifications
5. Cache and serve via MCP `get_diagnostics` tool

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

## Contributing

Contributions welcome! See [Development](#development) for setup.

Before submitting:

- Run `npm run format` and `npm test`
- Verify changes work with a real Godot project
- Keep scope focused on diagnostics (no project manipulation)

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

## Related Projects

- **[Model Context Protocol](https://modelcontextprotocol.io/)** - The protocol specification
- *
  *[Godot LSP Documentation](https://docs.godotengine.org/en/stable/tutorials/editor/external_editor.html)
  ** - Godot's Language Server setup
- **[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)** - Curated list of MCP
  servers
- **[godot-vscode-plugin](https://github.com/godotengine/godot-vscode-plugin)** - Official VSCode
  extension (uses same LSP)

**Alternative Godot MCP servers:**

- [ee0pdt/Godot-MCP](https://github.com/ee0pdt/Godot-MCP) - Full project control via custom plugin
- [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) - CLI-based GDScript operations

## License

MIT License - see [LICENSE](LICENSE)
