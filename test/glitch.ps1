param(
  [string]$OutDir = "$env:TEMP\telinha-glitch"
)

$projectFolder = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $projectFolder "node_modules\electron\dist\electron.exe"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -File | Remove-Item

function Start-TestInstance([string]$Role, [string]$Mode, [string[]]$ExtraArguments) {
  $arguments = @("`"$projectFolder`"", "--profile=$Role", "--autotest=$Mode", "--testdir=`"$OutDir`"") + $ExtraArguments
  Start-Process $electron -ArgumentList $arguments -RedirectStandardOutput "$OutDir\$Role.log" -RedirectStandardError "$OutDir\$Role.err" -PassThru
}

function Read-TestLines([string]$Role, [string]$Step) {
  Get-Content "$OutDir\$Role.log" | Where-Object { $_ -match "\[autotest\] ${Step}: " } | ForEach-Object {
    $_ -replace "^.*\[autotest\] ${Step}: ", '' | ConvertFrom-Json
  }
}

$animation = Start-Process $electron -ArgumentList "`"$projectFolder\test\animation-window.js`"" -PassThru
Start-Sleep -Seconds 2
$hostInstance = Start-TestInstance "host" "glitch-host" @()
Start-Sleep -Seconds 3
$viewerInstance = Start-TestInstance "viewer" "glitch-viewer" @()
Start-Sleep -Seconds 28
$extraViewerInstance = Start-TestInstance "viewer2" "extra-viewer" @()

foreach ($instance in @($viewerInstance, $hostInstance, $extraViewerInstance)) { $instance.WaitForExit(90000) | Out-Null }
foreach ($instance in @($animation, $hostInstance, $viewerInstance, $extraViewerInstance)) { if (-not $instance.HasExited) { Stop-Process -Id $instance.Id -Force } }

Get-Content "$OutDir\host.log", "$OutDir\viewer.log" | Where-Object { $_ -match 'FALHA|ERRO' }

$events = @(Read-TestLines "host" "evento")
if (-not $events.Count) { "Nenhum evento registrado."; exit 1 }
$startTime = $events[0].time

$timeline = @()
foreach ($event in $events) { $timeline += [pscustomobject]@{ time = $event.time; text = ">>> $($event.name)" } }
foreach ($sample in Read-TestLines "viewer" "amostra") {
  $blackPercent = if ($null -ne $sample.maxBlack) { "{0,5:N1}%" -f ($sample.maxBlack * 100) } else { "  -  " }
  $text = "{0,-10} preto {1}  {2}x{3} {4}fps  quadros={5} perdidos={6} congelou={7} keyframes={8}" -f $sample.connectionState, $blackPercent, $sample.width, $sample.height, $sample.framesPerSecond, $sample.framesDecoded, $sample.packetsLost, $sample.freezeCount, $sample.keyFramesDecoded
  $timeline += [pscustomobject]@{ time = $sample.time; text = $text }
}

"===== LINHA DO TEMPO ====="
foreach ($entry in ($timeline | Sort-Object time)) { "{0,6:N1}s  {1}" -f (($entry.time - $startTime) / 1000), $entry.text }
$lastOutbound = Read-TestLines "host" "envio-detalhe" | Select-Object -Last 1
"Envio no fim: $($lastOutbound | ConvertTo-Json -Compress)"
"Fontes durante o teste: $((Read-TestLines 'host' 'envio-detalhe' | ForEach-Object { "$($_.source)/audio=$($_.hasAudio)" } | Select-Object -Unique) -join ' -> ')"
"Decoder do viewer: $((Read-TestLines 'viewer' 'amostra' | Select-Object -Last 1).decoder)"
"Capturas com preto: $((Get-ChildItem "$OutDir\preto-*.png" -ErrorAction SilentlyContinue).Count) em $OutDir"
