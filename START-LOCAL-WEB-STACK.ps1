param(
    [string]$GodotPath = "",
    [string]$ServerEnvFile = ".env.server"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebRoot = Join-Path $ProjectRoot "web"
Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $WebRoot ".env"))) {
    throw "Run PREPARE-WEB-PLAYER.ps1 first."
}
if (-not (Test-Path (Join-Path $WebRoot "node_modules"))) {
    throw "Run PREPARE-WEB-PLAYER.ps1 first."
}
if (-not (Test-Path (Join-Path $WebRoot "public/game/index.html"))) {
    throw "The Godot web client is missing. Run PREPARE-WEB-PLAYER.ps1 first."
}
if (-not (Test-Path (Join-Path $ProjectRoot $ServerEnvFile))) {
    throw "Missing $ServerEnvFile. Copy .env.server.example to .env.server and fill in the Yokefellow bucket/app values."
}

$GodotArgument = if ($GodotPath) { " -GodotPath `"$GodotPath`"" } else { "" }
$authCommand = "Set-Location `"$WebRoot`"; npm start"
$serverCommand = "Set-Location `"$ProjectRoot`"; .\RUN-SHARED-SERVER.ps1$GodotArgument -EnvFile `"$ServerEnvFile`""

Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $authCommand) | Out-Null
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand) | Out-Null
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:8080" | Out-Null

Write-Host "Opened the wallet login page."
Write-Host "Two terminal windows are running: wallet/instant-mint service and authoritative Godot server."
Write-Host "Instant mint owner setup: http://127.0.0.1:8080/instant-mint.html"
