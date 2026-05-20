param(
    [string[]]$Languages = @("fr", "es", "de"),
    [switch]$AllLanguages,
    [switch]$SaveApiKeyToUserEnv
)

$ErrorActionPreference = "Stop"

if ($AllLanguages) {
    $Languages = @("en", "fr", "es", "de")
}

$generatorPath = Join-Path $PSScriptRoot "generate_sd_card_languages.py"
if (-not (Test-Path $generatorPath)) {
    throw "Cannot find generator script: $generatorPath"
}

$apiKey = $env:ELEVENLABS_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = [System.Environment]::GetEnvironmentVariable("ELEVENLABS_API_KEY", "User")
}
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $secureKey = Read-Host "Enter ELEVENLABS_API_KEY" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "ELEVENLABS_API_KEY is required."
}

$env:ELEVENLABS_API_KEY = $apiKey

if ($SaveApiKeyToUserEnv) {
    [System.Environment]::SetEnvironmentVariable("ELEVENLABS_API_KEY", $apiKey, "User")
}

Write-Host "Generating language packs: $($Languages -join ', ')"
& python $generatorPath --languages $Languages
exit $LASTEXITCODE
