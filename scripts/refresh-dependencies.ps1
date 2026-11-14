$ErrorActionPreference = 'Stop'

# Resolve npm.cmd explicitly. Calling the npm PowerShell shim with a splatted
# argument array can mis-forward arguments on some Windows PowerShell setups
# (for example, npm receives "pm" instead of "install").
$npmCommand = Get-Command 'npm.cmd' -CommandType Application -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    throw 'npm.cmd was not found on PATH. Reinstall Node.js or add its installation directory to PATH.'
}
$npmExecutable = $npmCommand.Source

$nodeVersionText = (& node.exe -p 'process.versions.node' | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed or is not on PATH.' }
try {
    $nodeVersion = [version]$nodeVersionText
} catch {
    throw "Could not parse Node.js version: $nodeVersionText"
}
if ($nodeVersion -lt [version]'22.13.0') {
    throw "Node.js 22.13.0 or later is required by the updated toolchain. Found $nodeVersionText."
}

$npmVersionText = (& $npmExecutable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'npm is not working correctly.' }
try {
    $npmVersion = [version]$npmVersionText
} catch {
    throw "Could not parse npm version: $npmVersionText"
}
if ($npmVersion -lt [version]'10.0.0') {
    throw "npm 10.0.0 or later is required. Found $npmVersionText."
}

Write-Host "Using Node.js $nodeVersionText and npm $npmVersionText" -ForegroundColor DarkGray
Write-Host '1/4 Installing declared dependencies and regenerating package-lock.json...' -ForegroundColor Cyan
# Do not run `npm ci` here: ci intentionally refuses to repair an out-of-sync
# lockfile. `npm install` resolves package.json and rewrites package-lock.json.
& $npmExecutable install --no-fund
$installExitCode = $LASTEXITCODE
if ($installExitCode -ne 0) {
    throw "npm install failed with exit code $installExitCode. package-lock.json may still be unchanged."
}

Write-Host '2/4 Running npm audit...' -ForegroundColor Cyan
& $npmExecutable audit --audit-level=moderate
$auditExitCode = $LASTEXITCODE
if ($auditExitCode -ne 0) {
    Write-Warning "npm audit returned exit code $auditExitCode. The audit report above must be reviewed. Continuing with project checks."
}

Write-Host '3/4 Running project checks...' -ForegroundColor Cyan
& $npmExecutable run check
$checkExitCode = $LASTEXITCODE
if ($checkExitCode -ne 0) {
    throw "npm run check failed with exit code $checkExitCode. See the first reported TypeScript/ESLint/build error above."
}

Write-Host '4/4 Rebuilding the Electron updater bundle and desktop assets...' -ForegroundColor Cyan
& $npmExecutable run prepare:electron
$prepareExitCode = $LASTEXITCODE
if ($prepareExitCode -ne 0) {
    throw "npm run prepare:electron failed with exit code $prepareExitCode."
}

if ($auditExitCode -ne 0) {
    throw 'Project checks and Electron preparation completed, but npm audit reported vulnerabilities or a registry error. Review the audit output before release.'
}

Write-Host 'Dependency refresh, audit, checks and Electron preparation completed successfully.' -ForegroundColor Green
