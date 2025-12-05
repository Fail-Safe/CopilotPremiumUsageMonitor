# Beta Testing Guide

## 🚀 Building a Beta Version

### Quick Beta Build

```bash
# 1. Bump version to beta
node scripts/release-bump.mjs minor  # Or 'patch' for 0.8.2-beta
npm version --no-git-tag-version $(node -p "require('./package.json').version")-beta

# 2. Update CHANGELOG.md
# Add a new section under [Unreleased] with version number and features

# 3. Build the VSIX package
npm run package

# 4. Install locally
code --install-extension copilot-premium-usage-monitor-X.X.X-beta.vsix
```

### Manual Steps

1. **Bump version to beta in `package.json`:**
   ```json
   "version": "0.9.0-beta",
   ```

2. **Add beta changelog entry in `CHANGELOG.md`:**
   ```markdown
   ## [0.9.0-beta] - 2025-11-01
   ### Added
   - Feature descriptions here
   ```

3. **Build VSIX package:**
   ```bash
   npm run package
   ```

4. **Install for testing:**
   ```bash
   # Via command line
   code --install-extension copilot-premium-usage-monitor-0.9.0-beta.vsix

   # OR via VS Code UI:
   # Extensions view (⇧⌘X) → "..." menu → "Install from VSIX..."
   ```

---

## 🔄 Reverting to Release Version

### Option 1: Git Revert (Recommended)

```bash
# Discard beta changes
git checkout package.json CHANGELOG.md

# Rebuild with release version
npm run package

# Reinstall release version
code --install-extension copilot-premium-usage-monitor-X.X.X.vsix
```

### Option 2: Manual Revert

1. **Remove `-beta` from `package.json`:**
   ```json
   "version": "0.9.0",  // Remove -beta suffix
   ```

2. **Remove or comment out beta section in `CHANGELOG.md`:**
   ```markdown
   ## [Unreleased]
   <!-- Beta features moved back to unreleased -->
   ```

3. **Rebuild:**
   ```bash
   npm run package
   code --install-extension copilot-premium-usage-monitor-0.9.0.vsix
   ```

---

## 🧪 Testing Workflow

### Development Testing (With Debugging)

```bash
# Start watch mode for auto-compilation
npm run compile

# In VS Code: Press F5
# This opens an "Extension Development Host" window
# Changes reload automatically
```

### Real Installation Testing

```bash
# Build beta package
npm run package

# Install in your actual VS Code
code --install-extension copilot-premium-usage-monitor-X.X.X-beta.vsix

# Reload VS Code window
# Cmd+Shift+P → "Developer: Reload Window"
```

### Uninstall Beta

```bash
# List installed extensions
code --list-extensions | grep copilot-premium-usage-monitor

# Uninstall
code --uninstall-extension fail-safe.copilot-premium-usage-monitor

# Or via UI: Extensions view → Right-click extension → Uninstall
```

---

## 📋 Beta Testing Checklist

### Before Building Beta

- [ ] All features implemented and tested locally (F5 debugging)
- [ ] All tests passing (`npm test`)
- [ ] Updated CHANGELOG.md with beta features
- [ ] Version bumped with `-beta` suffix
- [ ] No uncommitted changes that should be saved

### Testing Beta

- [ ] Extension activates without errors
- [ ] Status bar shows usage data
- [ ] Panel opens and displays correctly
- [ ] Settings can be modified
- [ ] New features work as expected
- [ ] No console errors in Developer Tools (Help → Toggle Developer Tools)
- [ ] Performance is acceptable

### Before Release

- [ ] Beta testing complete
- [ ] All issues resolved
- [ ] Remove `-beta` suffix from version
- [ ] Update CHANGELOG.md (move from beta to release)
- [ ] Run full test suite (`npm test`)
- [ ] Build final VSIX (`npm run package`)
- [ ] Test final VSIX installation

---

## 🔍 Debugging Beta Issues

### View Extension Logs

1. Open Command Palette (⇧⌘P)
2. Run: "Developer: Show Logs"
3. Select "Extension Host"

Or use the extension's built-in logging:
1. Command Palette → "Copilot Premium Usage Monitor: Show Logs"

### Check Extension Console

1. Help → Toggle Developer Tools
2. Console tab
3. Filter by extension name

### Common Issues

**Extension not loading:**
```bash
# Check if installed
code --list-extensions | grep copilot-premium-usage-monitor

# Try reinstalling
code --uninstall-extension fail-safe.copilot-premium-usage-monitor
code --install-extension copilot-premium-usage-monitor-X.X.X-beta.vsix
```

**Changes not taking effect:**
- Reload window: Cmd+Shift+P → "Developer: Reload Window"
- Or restart VS Code completely

**Old version still active:**
```bash
# Uninstall all versions
code --uninstall-extension fail-safe.copilot-premium-usage-monitor

# Reinstall specific version
code --install-extension copilot-premium-usage-monitor-X.X.X-beta.vsix
```

---

## 📝 Beta Versioning Convention

- **Patch beta**: `0.8.2-beta` (bug fixes)
- **Minor beta**: `0.9.0-beta` (new features)
- **Major beta**: `1.0.0-beta` (breaking changes)

### Semantic Versioning

- `patch`: Bug fixes only (0.8.1 → 0.8.2)
- `minor`: New features, backwards compatible (0.8.1 → 0.9.0)
- `major`: Breaking changes (0.9.0 → 1.0.0)

---

## 🎯 Current Beta (v0.9.0-beta)

### New Features
- Hybrid historical storage (3-tier: snapshots/daily/monthly)
- Multi-month intelligent analysis
- Growth trend detection
- Seasonality patterns
- Predictive forecasting
- Anomaly detection
- Auto-generated insights

### Testing Focus
- Historical data accumulation over 30+ days
- Monthly aggregate creation
- Trend analysis accuracy with 6+ months of data
- Seasonality detection with 12+ months
- Performance with large datasets

---

## 📚 Related Documentation

- [DEVELOPMENT.md](../.github/DEVELOPMENT.md) - Full development guide
- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [README.md](../README.md) - User documentation

---

## 💡 Tips

- **Use F5 for rapid development** - Changes reload instantly
- **Build VSIX only for real testing** - Tests actual installation
- **Keep beta suffix** - Prevents confusion with release versions
- **Test in clean environment** - Create a new VS Code profile for testing
- **Document issues** - Keep notes on bugs found during beta testing
- **Git stash beta changes** - Easy to switch between beta and release

```bash
# Stash beta version changes
git stash push -m "Beta 0.9.0 changes" package.json CHANGELOG.md

# Later, reapply beta changes
git stash list
git stash apply stash@{0}
```
