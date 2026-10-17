# Build Local AI Control Center as a standalone Windows .exe
#
# This script:
# 1. Builds the React frontend
# 2. Installs the desktop dependencies (pywebview, pyinstaller)
# 3. Packages everything into a portable .exe using PyInstaller
#
# Prerequisites:
#   - Node.js 18+ (for building the frontend)
#   - Python 3.11+ with uv (https://docs.astral.sh/uv/)
#
# Usage:
#   .\build-desktop.ps1

$ErrorActionPreference = "Stop"

$PROJECT_ROOT = $PSScriptRoot
$FRONTEND_DIR = Join-Path $PROJECT_ROOT "frontend"
$BACKEND_DIR = Join-Path $PROJECT_ROOT "backend"
$OUTPUT_DIR = Join-Path $PROJECT_ROOT "dist-desktop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Local AI Control Center - Desktop Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the frontend
Write-Host "[1/4] Building React frontend..." -ForegroundColor Yellow
Push-Location $FRONTEND_DIR
if (Test-Path "node_modules") {
    Write-Host "  node_modules exists, skipping npm install" -ForegroundColor Gray
} else {
    Write-Host "  Installing frontend dependencies..." -ForegroundColor Gray
    npm ci --prefer-offline 2>$null || npm install
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Frontend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Frontend built successfully." -ForegroundColor Green
Pop-Location

# Step 2: Install Python desktop dependencies
Write-Host "" -ForegroundColor White
Write-Host "[2/4] Installing Python desktop dependencies..." -ForegroundColor Yellow
Push-Location $BACKEND_DIR
uv pip install -e ".[desktop]" --system 2>$null
if ($LASTEXITCODE -ne 0) {
    # Fallback: try without --system
    uv pip install -e ".[desktop]"
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install Python dependencies!" -ForegroundColor Red
    exit 1
}
Write-Host "  Python dependencies installed." -ForegroundColor Green
Pop-Location

# Step 3: Clean previous build
Write-Host "" -ForegroundColor White
Write-Host "[3/4] Cleaning previous build artifacts..." -ForegroundColor Yellow
if (Test-Path $OUTPUT_DIR) {
    Remove-Item -Recurse -Force $OUTPUT_DIR
    Write-Host "  Removed old dist-desktop/" -ForegroundColor Gray
}
$BUILD_DIR = Join-Path $BACKEND_DIR "build"
if (Test-Path $BUILD_DIR) {
    Remove-Item -Recurse -Force $BUILD_DIR
}
$SPEC_DIR = Join-Path $BACKEND_DIR "desktop.spec"
# PyInstaller creates dist/ and build/ in the spec file directory
$PYINSTALLER_DIST = Join-Path $BACKEND_DIR "dist"
if (Test-Path $PYINSTALLER_DIST) {
    Remove-Item -Recurse -Force $PYINSTALLER_DIST
}
Write-Host "  Cleaned." -ForegroundColor Green

# Step 4: Build the .exe with PyInstaller
Write-Host "" -ForegroundColor White
Write-Host "[4/4] Building portable .exe with PyInstaller..." -ForegroundColor Yellow
Push-Location $BACKEND_DIR

# Build using PyInstaller command line
pyinstaller `
    --name "Local AI Control Center" `
    --windowed `
    --onedir `
    --noconfirm `
    --add-data "$PROJECT_ROOT/frontend/dist;frontend/dist" `
    --add-data "$BACKEND_DIR/app;app" `
    --add-data "$PROJECT_ROOT/.env.example;." `
    --hidden-import uvicorn `
    --hidden-import webview `
    --exclude-module pytest `
    --exclude-module pytest_asyncio `
    --exclude-module ruff `
    --exclude-module setuptools `
    --exclude-module pip `
    --distpath $OUTPUT_DIR `
    "$PROJECT_ROOT/desktop_app.py"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: PyInstaller build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}

Pop-Location

# Check the output
$EXE_DIR = Join-Path $OUTPUT_DIR "Local AI Control Center"
if (Test-Path $EXE_DIR) {
    $EXE_PATH = Join-Path $EXE_DIR "Local AI Control Center.exe"
    if (Test-Path $EXE_PATH) {
        $size = (Get-Item $EXE_PATH).Length
        $sizeMB = [math]::Round($size / 1MB, 2)
        
        # Calculate total directory size
        $totalSize = (Get-ChildItem -Recurse $EXE_DIR | Measure-Object -Property Length -Sum).Sum
        $totalMB = [math]::Round($totalSize / 1MB, 2)
        
        Write-Host "" -ForegroundColor White
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host " BUILD SUCCESSFUL!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "" -ForegroundColor White
        Write-Host "Output: $EXE_DIR" -ForegroundColor White
        Write-Host "Executable: $EXE_PATH" -ForegroundColor White
        Write-Host "Total size: ${totalMB} MB" -ForegroundColor White
        Write-Host "" -ForegroundColor White
        Write-Host "The entire folder is portable - copy it anywhere and run the .exe." -ForegroundColor Gray
        Write-Host "No installation, no PowerShell, no browser tabs needed." -ForegroundColor Gray
    } else {
        Write-Host "ERROR: .exe not found at expected location!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "ERROR: Output directory not found!" -ForegroundColor Red
    exit 1
}
