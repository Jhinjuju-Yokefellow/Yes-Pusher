param(
    [string]$GodotPath = "",
    [string]$EnvFile = ".env.server"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Missing $Path. Copy .env.server.example to .env.server and fill in the required values."
    }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) { return }
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process")
    }
}

function Resolve-Godot([string]$Requested) {
    if ($Requested) { return $Requested }
    foreach ($name in @("godot4", "godot", "Godot_v4.7.1-stable_win64.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
        $local = Join-Path $ProjectRoot $name
        if (Test-Path $local) { return $local }
    }
    throw "Godot 4.7.1 was not found. Pass -GodotPath with the full executable path."
}

Import-DotEnv (Join-Path $ProjectRoot $EnvFile)

# Local YD-5 physics testing must not depend on the production Bucket/App rails.
# If the Yokefellow connection values are missing or still placeholders, keep
# the authoritative machine fully local/test-mode so repeated turns work.
$yfUrl = [Environment]::GetEnvironmentVariable("YF_API_BASE_URL", "Process")
$yfBucket = [Environment]::GetEnvironmentVariable("YF_BUCKET_ID", "Process")
$yfKey = [Environment]::GetEnvironmentVariable("YF_APP_API_KEY", "Process")
$missingYokefellow = [string]::IsNullOrWhiteSpace($yfUrl) `
    -or [string]::IsNullOrWhiteSpace($yfBucket) `
    -or [string]::IsNullOrWhiteSpace($yfKey) `
    -or $yfUrl.StartsWith("REPLACE_WITH") `
    -or $yfBucket.StartsWith("REPLACE_WITH") `
    -or $yfKey.StartsWith("REPLACE_WITH")

if ($missingYokefellow) {
    [Environment]::SetEnvironmentVariable("YES_PUSHER_TEST_FREE_TURNS", "true", "Process")
    [Environment]::SetEnvironmentVariable("YES_PUSHER_PRESENTATION_TEST_MODE", "true", "Process")
    [Environment]::SetEnvironmentVariable("YES_PUSHER_FREE_TURN_COOLDOWN_SECONDS", "60", "Process")
    Write-Host "Yokefellow Bucket/App is not configured; starting local YD-5 test mode."
}

$Godot = Resolve-Godot $GodotPath
& $Godot --headless --path $ProjectRoot -- --server
exit $LASTEXITCODE
