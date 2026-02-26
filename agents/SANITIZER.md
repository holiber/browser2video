# Pre-commit Sanitization Rules

## Home directory path exposure

Scenario code, terminal commands, and recordings must **never** expose the real home directory path (e.g. `/Users/alexonn`, `/home/user`). Replace with `~` or a relative path.

### What to check

- **Terminal commands in scenarios**: use `~` instead of `os.homedir()` or absolute home paths when the command is visible in the recording.
- **`process.cwd()` in scenario shell commands**: prefer relative paths from the project root, or use `resolveCacheDir()` which returns a safe `.cache/` or `os.tmpdir()` path.
- **Hardcoded paths in test fixtures**: never commit paths containing a real username.
- **Log output / error messages**: if a scenario asserts on terminal output that may contain a home path, use a regex or partial match that avoids the full path.

### Quick self-test

Before committing, search staged diffs for patterns like `/Users/`, `/home/`, `C:\\Users\\`:

```bash
git diff --cached | grep -E '/(Users|home)/[a-zA-Z]' || echo "clean"
```

If hits appear in scenario source (not generated cache), replace with `~` or a relative path.
