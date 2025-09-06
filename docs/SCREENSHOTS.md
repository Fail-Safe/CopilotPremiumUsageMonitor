# SCREENSHOT GUIDE

This short guide explains how to build the extension and capture the official screenshots used in the Marketplace and README.

## Prerequisites
- macOS (these capture tips use macOS screen tools)
- Node 20+ and npm
- Visual Studio Code (Insiders or Stable)

## Quick steps
1. Build the extension bundle (this produces `out/extension.js`):

   npm run screenshot:prepare

2. Open the repo in VS Code (the `screenshot:open` script does this for you):

   npm run screenshot:open

3. Start an Extension Development Host
- In the Debug view, run "Launch Extension" (or press F5). A new VS Code window will open as the Extension Development Host.

4. Prepare the UI state for screenshots
- The extension contributes two preparation commands (visible in the Command Palette when in development):
  - "Copilot Premium Usage Monitor: Prepare Screenshot State (Normal)"
  - "Copilot Premium Usage Monitor: Prepare Screenshot State (Error)"

- Run the appropriate command from the Command Palette in the Extension Development Host. These commands configure the extension's internal state so the panel and status bar show the intended visuals for screenshots.

5. Capture screenshots on macOS
- Use the built-in capture tool (recommended):

   cmd+shift+4 then space → click the window to capture a single window.

- For full-screen or specific-size captures, use cmd+shift+5 and pick the region.
- Recommended screenshot sizes:
  - Status bar: capture the entire VS Code window at a common macOS Retina size (e.g., 1440x900) and crop to the status bar area.
  - Panel and sidebar: capture at 1440x900 or 1280x800 and crop to the panel/sidebar area.

6. Replace images in `media/` (optional)
- If you're updating the packaged screenshots, the repository uses `media/screenshot-panel.png` and `media/screenshot-statusbar.png`.
- Keep the existing filenames and overwrite them with the new PNGs. The Marketplace and README reference these filenames directly.

## Notes & tips
- If you need the "error" state, use the "Prepare Screenshot State (Error)" command.
- If text appears too small, increase the window size or use the macOS display scaling option to produce a nicer crop.
- For consistent colors across themes, test both a default and a dark theme if required.

## Troubleshooting
- If the extension doesn't show the expected data after running a prepare command, open the extension output channel (View → Output → "Copilot Premium Usage Monitor") to read debug logs.
- You can re-run the prepare command anytime; it only mutates in-memory state for the present Extension Development Host session.

Done.
