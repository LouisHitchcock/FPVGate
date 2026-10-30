param([string]$ArduinoJsonPath)
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path "$PSScriptRoot/../..").Path
if (!$ArduinoJsonPath) {
    $jsonHeader = Get-ChildItem "$repoPath/.pio/libdeps/*/ArduinoJson/src/ArduinoJson.h" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$jsonHeader) { throw 'Build a firmware target once, or pass -ArduinoJsonPath pointing to ArduinoJson/src' }
    $ArduinoJsonPath = $jsonHeader.DirectoryName
}
$buildPath = Join-Path $repoPath '.pio/event-director-test'
New-Item -ItemType Directory -Force $buildPath | Out-Null
Copy-Item "$PSScriptRoot/stubs/*" $buildPath -Recurse -Force
Copy-Item "$repoPath/lib/EVENTDIRECTOR/*", "$repoPath/lib/RACECONTROL/*", "$repoPath/lib/C5LINK/c5multipilot.h", "$repoPath/lib/C5LINK/c5multipilot.cpp", "$repoPath/lib/RACEHISTORY/racehistory.h" $buildPath -Force
& g++ -std=c++17 -O1 -Wall -Wextra -I $ArduinoJsonPath -I $buildPath "$buildPath/eventdirector.cpp" "$buildPath/c5racecontrol.cpp" "$buildPath/c5multipilot.cpp" "$PSScriptRoot/event-director.cpp" -o "$buildPath/event-director.exe"
if ($LASTEXITCODE -ne 0) { throw 'Event director native build failed' }
& "$buildPath/event-director.exe"
if ($LASTEXITCODE -ne 0) { throw 'Event director native checks failed' }
