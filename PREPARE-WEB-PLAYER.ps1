param(
    [string]$GodotPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebRoot = Join-Path $ProjectRoot "web"
Set-Location $ProjectRoot

function Resolve-Godot([string]$Requested) {
    if ($Requested) { return $Requested }
    foreach ($name in @("godot4", "godot", "Godot_v4.7.1-stable_win64.exe", "Godot_v4.7-stable_win64.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
        $local = Join-Path $ProjectRoot $name
        if (Test-Path $local) { return $local }
    }
    throw "Godot 4.7 was not found. Pass -GodotPath with the full executable path."
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value, [switch]$OnlyWhenMissingOrBlank) {
    $pattern = "(?m)^$([regex]::Escape($Name))=(.*)$"
    $match = [regex]::Match($Content, $pattern)
    if ($match.Success) {
        if ($OnlyWhenMissingOrBlank -and -not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
            return $Content
        }
        return [regex]::Replace($Content, $pattern, "$Name=$Value")
    }
    if (-not $Content.EndsWith("`n")) { $Content += "`r`n" }
    return $Content + "$Name=$Value`r`n"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22 or newer is required for the YES drop web shell."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required for the YES drop web shell."
}

$WebEnv = Join-Path $WebRoot ".env"
if (-not (Test-Path $WebEnv)) {
    Copy-Item (Join-Path $WebRoot ".env.example") $WebEnv
    Write-Host "Created web/.env from web/.env.example."
}

Push-Location $WebRoot
npm install
npm run check
Pop-Location

$ServerEnv = Join-Path $ProjectRoot ".env.server"
if (-not (Test-Path $ServerEnv)) {
    $ServerEnvExample = Join-Path $ProjectRoot ".env.server.example"
    if (Test-Path $ServerEnvExample) {
        Copy-Item $ServerEnvExample $ServerEnv
        Write-Host "Created .env.server from .env.server.example. Fill the Yokefellow connection values before starting the stack."
    }
}
if (Test-Path $ServerEnv) {
    Write-Host ".env.server is present."
} else {
    Write-Warning "No .env.server exists yet. Copy .env.server.example to .env.server, fill in the YokefellowNetwork values for YD-8, and run this command again."
}

$Godot = Resolve-Godot $GodotPath
$GameDir = Join-Path $WebRoot "public/game"
if (Test-Path $GameDir) {
    Get-ChildItem -Force $GameDir | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $GameDir | Out-Null
$exportPath = Join-Path $GameDir "index.html"
$godotArgs = @("--headless", "--path", $ProjectRoot, "--export-release", "Web", $exportPath)
$process = Start-Process -FilePath $Godot -ArgumentList $godotArgs -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Godot web export failed with exit code $($process.ExitCode)." }
if (-not (Test-Path $exportPath)) { throw "Godot reported success but the web export was not created." }

Write-Host ""
Write-Host "Web wallet player prepared."
Write-Host "Next: .\START-LOCAL-WEB-STACK.ps1 -GodotPath `"$Godot`""
Write-Host "Local physics mode works with placeholder Network values; YD-8 integration requires the live YES drop Network values."
