# Start local debugging for ArrangeV4 Next.js app
$ErrorActionPreference = "Stop"

$npmPath = Get-Command npm.cmd -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty Source
if (-not $npmPath) {
    $wingetNodeRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe"
    $npmPath = Get-ChildItem $wingetNodeRoot -Filter npm.cmd -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $npmPath) {
    throw "npm was not found. Install Node.js LTS, then restart PowerShell."
}

$nodeDirectory = Split-Path $npmPath
$env:Path = "$nodeDirectory;$env:Path"

Push-Location "$PSScriptRoot\src\arrange-v4"
try {
    & $npmPath run dev
}
finally {
    Pop-Location
}
