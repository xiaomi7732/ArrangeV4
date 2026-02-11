# Start local debugging for ArrangeV4 Next.js app
$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot\src\arrange-v4"
try {
    npm run dev
}
finally {
    Pop-Location
}
