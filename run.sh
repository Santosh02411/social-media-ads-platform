#!/usr/bin/env bash
# AdSync — Unified Social Media Ads Platform
# Quick start script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ⚡  AdSync — Unified Social Media Ads Platform"
echo "═══════════════════════════════════════════════════════"

# Check Python
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
    echo "❌ Python 3 is required but not found."
    exit 1
fi

PYTHON=$(command -v python3 || command -v python)
echo "  ✅  Python: $($PYTHON --version)"

# Install dependencies
echo ""
echo "  📦  Installing dependencies..."
$PYTHON -m pip install -r requirements.txt -q

# Create .env if missing
if [ ! -f ".env" ]; then
    echo "  📝  Creating .env from .env.example..."
    cp .env.example .env
    echo "  ⚠️   Edit .env to set a real SECRET_KEY before deploying to production."
fi

# Create uploads dir
mkdir -p static/uploads

echo ""
echo "  🌐  Starting at http://localhost:5000"
echo "  📋  See information.md for credential setup."
echo "  Press Ctrl+C to stop."
echo "═══════════════════════════════════════════════════════"
echo ""

$PYTHON app.py
