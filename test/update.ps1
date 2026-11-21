param(
  [string]$OutDir = "$env:TEMP\telinha-update"
)

$projectFolder = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $projectFolder "node_modules\electron\dist\electron.exe"
$feedFolder = Join-Path $OutDir "feed"
$feedPort = 47860
$feedUrl = "http://127.0.0.1:$feedPort/"
$devUpdateConfig = Join-Path $projectFolder "dev-app-update.yml"
New-Item -ItemType Directory -Force $feedFolder | Out-Null
Get-ChildItem $OutDir -File -Recurse | Remove-Item

$currentVersion = (Get-Content (Join-Path $projectFolder "package.json") | ConvertFrom-Json).version
$parts = $currentVersion.Split('.')
$newerVersion = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"

"Gerando a versão falsa $newerVersion..."
Push-Location $projectFolder
npx electron-builder --win nsis --publish never "-c.extraMetadata.version=$newerVersion" "-c.directories.output=$feedFolder" "-c.publish.provider=generic" "-c.publish.url=$feedUrl" 2>&1 | Where-Object { $_ -match 'building|rror' }
Pop-Location

"provider: generic`nurl: $feedUrl`nupdaterCacheDirName: telinha-updater-test" | Set-Content -Encoding utf8 $devUpdateConfig
$server = Start-Process node -ArgumentList "-e", "`"require('http').createServer((q,r)=>{const f=require('path').join(process.argv[1],decodeURIComponent(q.url.split('?')[0]));require('fs').createReadStream(f).on('error',()=>{r.statusCode=404;r.end()}).pipe(r)}).listen($feedPort)`"", "`"$feedFolder`"" -PassThru -WindowStyle Hidden

try {
  $app = Start-Process $electron -ArgumentList "`"$projectFolder`"", "--profile=update", "--autotest=update", "--update-feed=$feedUrl", "--testdir=`"$OutDir`"" -RedirectStandardOutput "$OutDir\update.log" -RedirectStandardError "$OutDir\update.err" -PassThru
  $app.WaitForExit(120000) | Out-Null
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $devUpdateConfig -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "telinha-updater-test") -ErrorAction SilentlyContinue
}

"Versão instalada: $currentVersion  ->  versão oferecida: $newerVersion"
Get-Content "$OutDir\update.log" | Where-Object { $_ -match 'atualiza|ERRO|FALHA' }
