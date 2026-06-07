#!/usr/bin/env bash
#
# Install Aperant-MCP Linux desktop entry
# Registers a taskbar/dock icon that launches Aperant with the external watchdog.
#
# Usage:
#   ./install.sh              Install for current user (~/.local/)
#   sudo ./install.sh --system  Install system-wide (/usr/local/)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Detect install scope ──────────────────────────────────────────────────────
SCOPE="user"
if [[ "${1:-}" == "--system" ]]; then
  SCOPE="system"
fi

if [[ "$SCOPE" == "system" && "$EUID" -ne 0 ]]; then
  echo "[install] System-wide install requires sudo. Run: sudo $0 --system"
  exit 1
fi

# ── Resolve paths ─────────────────────────────────────────────────────────────
FRONTEND_DIR="$REPO_DIR/apps/frontend"
ICON_SOURCE="$FRONTEND_DIR/resources/icon-256.png"

if [[ "$SCOPE" == "user" ]]; then
  INSTALL_BIN_DIR="$HOME/.local/bin"
  INSTALL_APP_DIR="$HOME/.local/share/applications"
  INSTALL_ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
else
  INSTALL_BIN_DIR="/usr/local/bin"
  INSTALL_APP_DIR="/usr/share/applications"
  INSTALL_ICON_DIR="/usr/share/icons/hicolor/256x256/apps"
fi

# ── Validate repo ─────────────────────────────────────────────────────────────
if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
  echo "[install] ERROR: Could not find Aperant-MCP repository."
  exit 1
fi

if [[ ! -f "$ICON_SOURCE" ]]; then
  echo "[install] ERROR: Icon not found at $ICON_SOURCE"
  exit 1
fi

echo "[install] Installing Aperant-MCP desktop entry ($SCOPE)..."

# ── Create directories ────────────────────────────────────────────────────────
mkdir -p "$INSTALL_BIN_DIR"
mkdir -p "$INSTALL_APP_DIR"
mkdir -p "$INSTALL_ICON_DIR"

# ── Install launcher script ───────────────────────────────────────────────────
# Substitute the actual repo path so the installed script can find it
sed "s|REPO_DIR=\"\$(cd \"\$SCRIPT_DIR/../..\" && pwd)\"|REPO_DIR=\"$REPO_DIR\"|" \
  "$SCRIPT_DIR/aperant" > "$INSTALL_BIN_DIR/aperant"
chmod +x "$INSTALL_BIN_DIR/aperant"
echo "[install] Installed launcher: $INSTALL_BIN_DIR/aperant"

# ── Install icon ──────────────────────────────────────────────────────────────
cp "$ICON_SOURCE" "$INSTALL_ICON_DIR/aperant-mcp.png"
echo "[install] Installed icon: $INSTALL_ICON_DIR/aperant-mcp.png"

# ── Install .desktop file ─────────────────────────────────────────────────────
sed -e "s|@@INSTALL_DIR@@|$INSTALL_BIN_DIR|g" \
    -e "s|@@ICON_PATH@@|$INSTALL_ICON_DIR/aperant-mcp.png|g" \
    "$SCRIPT_DIR/aperant.desktop" > "$INSTALL_APP_DIR/aperant-mcp.desktop"
chmod +x "$INSTALL_APP_DIR/aperant-mcp.desktop"
echo "[install] Installed desktop entry: $INSTALL_APP_DIR/aperant-mcp.desktop"

# ── Update desktop database ───────────────────────────────────────────────────
if command -v update-desktop-database &>/dev/null; then
  if [[ "$SCOPE" == "user" ]]; then
    update-desktop-database "$INSTALL_APP_DIR" 2>/dev/null || true
  else
    update-desktop-database 2>/dev/null || true
  fi
  echo "[install] Updated desktop database"
fi

# ── Update icon cache ─────────────────────────────────────────────────────────
if command -v gtk-update-icon-cache &>/dev/null; then
  if [[ "$SCOPE" == "system" ]]; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
  fi
  echo "[install] Updated icon cache"
fi

echo ""
echo "========================================"
echo "  Aperant-MCP installed successfully!"
echo "========================================"
echo ""
echo "  Launcher:   $INSTALL_BIN_DIR/aperant"
echo "  Desktop:    $INSTALL_APP_DIR/aperant-mcp.desktop"
echo "  Icon:       $INSTALL_ICON_DIR/aperant-mcp.png"
echo ""

if [[ "$SCOPE" == "user" ]]; then
  echo "  The app should now appear in your applications menu."
  echo "  You can also pin it to your taskbar/dock from the app launcher."
  echo ""
  echo "  If the icon doesn't appear immediately, run:"
  echo "    killall -SIGUSR1 kgx 2>/dev/null || true   # GNOME Console"
  echo "    killall -SIGUSR1 gnome-shell 2>/dev/null || true"
  echo "    # Or simply log out and back in"
else
  echo "  System-wide install complete."
fi

echo ""
echo "  Usage:"
echo "    aperant              Launch dev mode with watchdog"
echo "    aperant --packaged   Launch packaged build with watchdog"
echo "    aperant --direct     Launch without watchdog"
echo ""
