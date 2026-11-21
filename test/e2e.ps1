param(
  [string]$OutDir = "$env:TEMP\telinha-e2e",
  [string]$AnimationKind = "game"
)

$projectFolder = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $projectFolder "node_modules\electron\dist\electron.exe"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Remove-Item "$OutDir\*" -ErrorAction SilentlyContinue

function Start-TestInstance([string]$Role, [string[]]$ExtraArguments) {
  $arguments = @("`"$projectFolder`"", "--profile=$Role", "--autotest=$Role", "--testdir=`"$OutDir`"") + $ExtraArguments
  Start-Process $electron -ArgumentList $arguments -RedirectStandardOutput "$OutDir\$Role.log" -RedirectStandardError "$OutDir\$Role.err" -PassThru
}

function Read-TestValues([string]$Role, [string]$Step) {
  Get-Content "$OutDir\$Role.log" | Where-Object { $_ -match "\[autotest\] ${Step}: " } | ForEach-Object {
    $json = ($_ -replace "^.*\[autotest\] ${Step}: ", '') -replace ' video \d+x\d+$', ''
    $json = $json -replace '^(connecting|connected|disconnected|failed) ', ''
    try { $json | ConvertFrom-Json } catch { }
  }
}

$hostInstance = Start-TestInstance "host" @("--motion=$AnimationKind")
Start-Sleep -Seconds 3
$viewerInstance = Start-TestInstance "viewer" @()
$viewerInstance.WaitForExit(90000) | Out-Null
$hostInstance.WaitForExit(30000) | Out-Null
foreach ($instance in @($hostInstance, $viewerInstance)) { if (-not $instance.HasExited) { Stop-Process -Id $instance.Id -Force } }

"===== QUEM TRANSMITE ====="
Get-Content "$OutDir\host.log" | Where-Object { $_ -match 'ao vivo|trocando|ERRO|FALHA|audiocap' } | ForEach-Object { $_ -replace '^\[ui:host\] ', '' }
foreach ($stats in Read-TestValues "host" "envio") {
  if (-not $stats.video) { continue }
  "{0,6:N1} Mbps  {1}x{2}  {3} fps (captura {4})  {5}  limite={6}" -f ($stats.kilobitsPerSecond / 1000), $stats.video.width, $stats.video.height, $stats.video.framesPerSecond, $stats.captureFramesPerSecond, $stats.video.codecName, $stats.video.limitationReason
}

"===== QUEM ASSISTE ====="
Get-Content "$OutDir\viewer.log" | Where-Object { $_ -match 'salas descobertas|assistindo:|ERRO|FALHA' } | ForEach-Object {
  $line = $_ -replace '^\[ui:viewer\] ', ''
  $line.Substring(0, [Math]::Min(200, $line.Length))
}
foreach ($stats in Read-TestValues "viewer" "recebendo") {
  if (-not $stats.video) { continue }
  "{0,6:N1} Mbps  {1}x{2}  {3} fps  perdidos={4}  ping={5} ms  rota={6}" -f ($stats.kilobitsPerSecond / 1000), $stats.video.width, $stats.video.height, $stats.video.framesPerSecond, $stats.video.packetsLost, [Math]::Round($stats.roundTripSeconds * 1000), $stats.route
}
"Capturas de tela: $OutDir"
