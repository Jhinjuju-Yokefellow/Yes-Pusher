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
$Godot = Resolve-Godot $GodotPath
& $Godot --headless --path $ProjectRoot -- --server
exit $LASTEXITCODE
