# Copies every filled-in key from .env.local into Windows user environment
# variables, so Claude Code skills can read them. Never prints key values.
$envFile = Join-Path $PSScriptRoot '..\.env.local'
if (-not (Test-Path $envFile)) { Write-Error ".env.local not found"; exit 1 }

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'User')
        Write-Host "Saved $($Matches[1])"
    }
}
Write-Host "Done. Fully quit and reopen VS Code to load the keys."
