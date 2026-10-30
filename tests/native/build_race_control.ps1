$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path "$PSScriptRoot/../..").Path
$buildPath = Join-Path $repoPath '.pio/race-control-test'
New-Item -ItemType Directory -Force $buildPath | Out-Null
Copy-Item "$PSScriptRoot/stubs/*" $buildPath -Recurse -Force
Copy-Item "$repoPath/lib/C5LINK/c5multipilot.h", "$repoPath/lib/C5LINK/c5multipilot.cpp", "$repoPath/lib/RACECONTROL/c5racecontrol.h", "$repoPath/lib/RACECONTROL/c5racecontrol.cpp", "$repoPath/lib/RACECONTROL/c5raceevents.h", "$repoPath/lib/RACEHISTORY/racehistory.h" $buildPath -Force
& g++ -std=c++17 -O1 -Wall -Wextra -I $buildPath "$buildPath/c5multipilot.cpp" "$buildPath/c5racecontrol.cpp" "$PSScriptRoot/race-control.cpp" -o "$buildPath/race-control.exe"
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
& "$buildPath/race-control.exe"
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed' }
