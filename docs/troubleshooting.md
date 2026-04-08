# Troubleshooting

## Connection Issues

### "Connection refused on port 6007"

**Causes:**

- Godot editor not running
- LSP disabled in Godot settings
- Different port configured

**Solutions:**

1. Start Godot with your project open
2. In Godot 4, enable Advanced Settings, then verify LSP is enabled under `Editor Settings → Network → Language Server`
3. Check the port: `nc -zv localhost 6007`
4. If using a different port, set `GODOT_LSP_PORT` environment variable

### Connection drops intermittently

The server automatically reconnects when Godot restarts. If issues persist:

1. Check Godot isn't crashing (view Godot console)
2. Ensure only one LSP client connects at a time

## Diagnostic Issues

### No diagnostics returned

**Causes:**

- File not part of a Godot project (no `project.godot` in parent directories)
- File path is relative instead of absolute
- Syntax is actually valid

**Solutions:**

1. Use absolute paths: `/Users/you/project/scripts/player.gd`
2. Verify file is inside a Godot project directory
3. Check if Godot shows errors when you open the file in the editor

### Stale or outdated diagnostics

The server caches diagnostics from Godot's LSP. If diagnostics seem stale:

1. Save the file in your editor
2. Wait ~500ms for Godot to process
3. Request diagnostics again

### Workspace scan missing files

`scan_workspace_diagnostics` excludes:

- `addons/` directory
- `.godot/` directory

If files are missing, check they're not in excluded directories.

## Environment Issues

### Workspace not detected

Set `GODOT_WORKSPACE_PATH` explicitly in your MCP client config:

```json
{
  "env": {
    "GODOT_WORKSPACE_PATH": "/absolute/path/to/your/godot/project"
  }
}
```

The server also auto-detects workspace from:

1. Current working directory (if contains `project.godot`)
2. Godot's `changeWorkspace` notification

## Debug Logging

### Enable Godot LSP logs

In Godot 4, enable Advanced Settings, then check `Editor Settings → Network → Language Server` (including `Remote Port`) and enable logging if needed.

### View MCP server output

Run the server directly to see connection logs:

```bash
node /path/to/minimal-godot-mcp/dist/index.js
```
