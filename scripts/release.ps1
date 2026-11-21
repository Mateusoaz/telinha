param(
  [Parameter(Mandatory = $true)][string]$Version
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
$env:GH_TOKEN = & $githubCli auth token
if (-not $env:GH_TOKEN) { throw 'Voce nao esta logado no GitHub. Rode: gh auth login' }

Invoke-Step "Mudando a versao para $Version" { npm version $Version --no-git-tag-version }
Invoke-Step 'Criando o commit da versao' { git add package.json package-lock.json; git commit -m "Versao $Version" }
Invoke-Step 'Criando a tag' { git tag "v$Version" }
Invoke-Step 'Enviando o codigo pro GitHub' { git push origin HEAD; git push origin "v$Version" }
Invoke-Step 'Compilando o captador de audio' { npm run build:audio }
Invoke-Step 'Gerando e publicando o instalador' { npx electron-builder --win nsis portable --publish always }

$homepage = (Get-Content package.json -Raw | ConvertFrom-Json).homepage
Write-Host ""
Write-Host "Versao $Version publicada: $homepage/releases/tag/v$Version"
Write-Host 'Quem tem o Telinha instalado vai ver o aviso de atualizacao na proxima vez que abrir (ou em ate 30 minutos).'
