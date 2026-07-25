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

function New-HexSecret([int]$ByteCount = 48) {
    $secretBytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($secretBytes)
    } finally {
        $rng.Dispose()
    }
    return -join ($secretBytes | ForEach-Object { $_.ToString("x2") })
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
    throw "Node.js 22 or newer is required for the wallet login and instant mint service."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required for the wallet login and instant mint service."
}

$WebEnv = Join-Path $WebRoot ".env"
if (-not (Test-Path $WebEnv)) {
    $secret = New-HexSecret 48
    $template = Get-Content (Join-Path $WebRoot ".env.example") -Raw
    $template = $template.Replace("REPLACE_WITH_A_LONG_RANDOM_SECRET", $secret)
    Set-Content -Path $WebEnv -Value $template -NoNewline
    Write-Host "Created web/.env with a private local session secret."
}

Push-Location $WebRoot
npm install
npm run check
Pop-Location

$ServerEnv = Join-Path $ProjectRoot ".env.server"
if (Test-Path $ServerEnv) {
    $content = Get-Content $ServerEnv -Raw
    $content = Set-EnvValue $content "YF_SESSION_VERIFY_URL" "http://127.0.0.1:8080/auth/session/verify"
    $content = Set-EnvValue $content "YF_INSTANT_MINT_URL" "http://127.0.0.1:8080/mint/instant"
    $content = Set-EnvValue $content "YF_RPC_URL" "https://sepolia.base.org" -OnlyWhenMissingOrBlank
    $content = Set-EnvValue $content "YF_INSTANT_MINT_SECRET" (New-HexSecret 48) -OnlyWhenMissingOrBlank

    $privateKeyMatch = [regex]::Match($content, '(?m)^YF_NFT_MINT_PRIVATE_KEY=(.*)$')
    if (-not $privateKeyMatch.Success -or [string]::IsNullOrWhiteSpace($privateKeyMatch.Groups[1].Value)) {
        Push-Location $WebRoot
        $privateKey = (& node --input-type=module -e "import { Wallet } from 'ethers'; process.stdout.write(Wallet.createRandom().privateKey);").Trim()
        Pop-Location
        if ($privateKey -notmatch '^0x[0-9a-fA-F]{64}$') {
            throw "Could not generate the dedicated Base Sepolia instant mint signer."
        }
        $content = Set-EnvValue $content "YF_NFT_MINT_PRIVATE_KEY" $privateKey
        Write-Host "Created a dedicated server-only Base Sepolia NFT mint signer."
    }

    Set-Content -Path $ServerEnv -Value $content -NoNewline
    Write-Host "Connected .env.server to the local wallet verifier and instant minter."
} else {
    Write-Warning "No .env.server exists yet. Copy .env.server.example to .env.server, fill in the Yokefellow bucket/app values, and run this command again."
}

$Godot = Resolve-Godot $GodotPath
$GameDir = Join-Path $WebRoot "public/game"
if (Test-Path $GameDir) {
    Get-ChildItem -Force $GameDir | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $GameDir | Out-Null
& $Godot --headless --path $ProjectRoot --export-release "Web" (Join-Path $GameDir "index.html")
if ($LASTEXITCODE -ne 0) { throw "Godot web export failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "Web wallet player prepared."
Write-Host "Next: .\START-LOCAL-WEB-STACK.ps1 -GodotPath `"$Godot`""
Write-Host "For first-time Instant NFT setup, open http://127.0.0.1:8080/instant-mint.html after starting the stack."
