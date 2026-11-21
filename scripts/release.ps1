param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = 'Quem tem o Telinha instalado recebe esta versao sozinho: o app baixa e mostra o aviso "Atualizar e reiniciar".'
)

$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
Set-Location $projectFolder

function Invoke-Step([string]$Description, [scriptblock]$Command) {
  Write-Host "==> $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $Description" }
}

function Find-GitHubCli {
  $installed = Get-Command gh -ErrorAction SilentlyContinue
  if ($installed) { return $installed.Source }
  $defaultPath = 'C:\Program Files\GitHub CLI\gh.exe'
  if (Test-Path $defaultPath) { return $defaultPath }
  throw 'GitHub CLI nao encontrado. Instale com: winget install GitHub.cli'
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versao invalida. Use o formato 1.2.3' }
if (git status --porcelain) { throw 'Tem alteracao sem commit. Faca o commit antes de lancar uma versao.' }

$githubCli = Find-GitHubCli
& $githubCli auth status *> $null
if ($LASTEXITCODE -ne 0) { throw 'Voce nao esta logado no GitHub. Rode: gh auth login' }

Invoke-Step "Mudando a versao para $Version" { npm version $Version --no-git-tag-version }
Invoke-Step 'Criando o commit da versao' { git add package.json package-lock.json; git commit -m "Versao $Version" }
Invoke-Step 'Criando a tag' { git tag "v$Version" }
Invoke-Step 'Enviando o codigo pro GitHub' { git push origin HEAD; git push origin "v$Version" }
Invoke-Step 'Compilando o captador de audio' { npm run build:audio }
Invoke-Step 'Gerando o instalador' { npx electron-builder --win nsis portable --publish never }

$outputFolder = Join-Path $projectFolder "release\$Version"
$releaseFiles = @(
  (Join-Path $outputFolder "Telinha-Instalador-$Version.exe"),
  (Join-Path $outputFolder "Telinha-Instalador-$Version.exe.blockmap"),
  (Join-Path $outputFolder "Telinha-Portatil-$Version.exe"),
  (Join-Path $outputFolder 'latest.yml')
)
foreach ($releaseFile in $releaseFiles) { if (-not (Test-Path $releaseFile)) { throw "Arquivo nao gerado: $releaseFile" } }
Invoke-Step 'Publicando no GitHub' { & $githubCli release create "v$Version" @releaseFiles --title "Telinha $Version" --notes $Notes }

$homepage = (Get-Content package.json -Raw | ConvertFrom-Json).homepage
Write-Host ''
Write-Host "Versao $Version publicada: $homepage/releases/tag/v$Version"
Write-Host 'Quem tem o Telinha instalado vai ver o aviso de atualizacao ao abrir o app (ou em ate 30 minutos).'
