# Release rehearsal for DSH-Superagent: one command that says whether this checkout may be published.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1 -SkipTests   # skips typecheck/tests, still builds lib
#
# It checks the things that must never be wrong for a public release: the tree is clean and pushed, the attribution to
# the upstream project is present everywhere a reader looks, the committed build matches a fresh build, the whole test
# suite passes, and the published release's assets match the checksum the one-line installer will verify.
#
# Any Skip switch makes the verdict `NOT VERIFIED` (exit 2): a partial run must never print READY TO PUBLISH.
#
# Nothing here is tied to one machine: the version comes from package.json, the tool locations are discovered, and the
# repository name is a parameter.
[CmdletBinding()]
param(
  [string]$Version,                                   # defaults to package.json
  [string]$Repo = 'ReSerendipity/dsh-superagent',
  [string]$Gh,                                        # defaults to a discovered gh.exe
  [switch]$SkipTests,
  [switch]$SkipOnline
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pass = New-Object System.Collections.Generic.List[string]
$fail = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

function Check([string]$name, [scriptblock]$probe) {
  try {
    $result = & $probe
    $null = $pass.Add($name)
    Write-Host ('PASS  ' + $name) -ForegroundColor Green
    if ($result) { Write-Host ('      ' + $result) -ForegroundColor DarkGray }
  } catch {
    $null = $fail.Add($name + ' — ' + $_.Exception.Message.Trim())
    Write-Host ('FAIL  ' + $name + ' — ' + $_.Exception.Message.Trim()) -ForegroundColor Red
  }
}

function Need($condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Find-Tool([string]$name, [string[]]$candidates) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

Write-Host ''
Write-Host '=== DSH-Superagent release check ===' -ForegroundColor Cyan
Write-Host ('repository : ' + $Repo)
Write-Host ('checkout   : ' + $root)

# ---------------------------------------------------------------- version
if (-not $Version) {
  $Version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
}
Write-Host ('version    : ' + $Version)
Write-Host ''

$git = Find-Tool 'git' @('C:\Program Files\Git\cmd\git.exe')
$pnpm = Find-Tool 'pnpm.cmd' @((Join-Path $env:APPDATA 'npm\pnpm.cmd'))
# Git for Windows ships a GNU tar first on PATH, and it reads 'C:\...' as a remote host; the system bsdtar does not.
$tar = Join-Path (Join-Path ${env:SystemRoot} 'System32') 'tar.exe'
if (-not (Test-Path -LiteralPath $tar)) { $tar = Find-Tool 'tar.exe' @() }
$node = Find-Tool 'node.exe' @((Join-Path (Join-Path ${env:ProgramFiles} 'nodejs') 'node.exe'))
if (-not $node) { $node = Find-Tool 'node' @() }
$gh = $Gh
if (-not $gh) {
  $gh = Find-Tool 'gh' @(
    (Join-Path ${env:ProgramFiles} 'GitHub CLI\gh.exe')
  )
}

# ---------------------------------------------------------------- source state
Check 'git repository present' {
  Need ($git -and (Test-Path -LiteralPath (Join-Path $root '.git'))) 'not a git checkout'
  & $git -C $root rev-parse --short HEAD
}

Check 'working tree clean' {
  $dirty = & $git -C $root status --porcelain
  Need (-not $dirty) ("uncommitted files: " + (($dirty | Select-Object -First 5) -join ', '))
  'no uncommitted files'
}

Check 'branch pushed' {
  $local = (& $git -C $root rev-parse HEAD).Trim()
  $remote = (& $git -C $root rev-parse 'origin/main').Trim()
  Need ($local -eq $remote) 'local HEAD differs from origin/main; push before publishing'
  $local.Substring(0, 8)
}

# ---------------------------------------------------------------- attribution (must stay visible)
Check 'attribution present' {
  $readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
  $notice = Get-Content -LiteralPath (Join-Path $root 'NOTICE') -Raw
  $license = Get-Content -LiteralPath (Join-Path $root 'LICENSE') -Raw
  $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $zh = Get-Content -LiteralPath (Join-Path $root 'locale\zh.json') -Raw
  $en = Get-Content -LiteralPath (Join-Path $root 'locale\en.json') -Raw
  $upstream = 'deepseek-ai/dsh-superagent-prototype'
  Need ($readme -like "*$upstream*") 'README does not name the upstream repository'
  Need ($notice -like "*$upstream*") 'NOTICE does not name the upstream repository'
  Need ($license -like '*DeepSeek Harness Team*') 'LICENSE lost the upstream copyright line'
  Need ($zh -like "*$upstream*" -and $en -like "*$upstream*") 'locale metadata does not name upstream'
  Need ($package.license -eq 'MIT') 'package.json licence is not MIT'
  Need (($package.repository | ConvertTo-Json -Compress) -like '*ReSerendipity/dsh-superagent*') 'package.json repository does not point at this repository'
  Need (($package.description -like "*$upstream*") -and (($package.contributors | ConvertTo-Json -Compress) -like '*DeepSeek Harness Team*')) 'package.json attribution does not name upstream'
  'README, NOTICE, LICENSE, locale and package metadata all name upstream'
}

Check 'changelog has this version' {
  $changelog = Get-Content -LiteralPath (Join-Path $root 'CHANGELOG.md') -Raw
  Need ($changelog -match ('(?m)^## \[' + [regex]::Escape($Version) + '\]')) ('CHANGELOG.md has no section for ' + $Version)
  $Version
}

# ---------------------------------------------------------------- build and lib freshness
Check 'pnpm available' { Need $pnpm 'pnpm not found on PATH'; & $pnpm --version }

# A git install serves `lib/` as committed, so a stale build ships old behaviour while every source-level check
# stays green. This file itself is the one that caught a stale lib twice; keep it a gate in every mode, including
# -SkipTests, and build first so "clean" really means "matches src".
Check 'committed lib matches a fresh build' {
  Push-Location $root
  try { & $pnpm build | Out-Null; Need ($LASTEXITCODE -eq 0) ('build exited ' + $LASTEXITCODE) }
  finally { Pop-Location }
  $dirty = & $git -C $root status --porcelain -- lib
  Need (-not $dirty) ('lib/ is stale - rebuild and commit it: ' + (($dirty | Select-Object -First 5) -join ', '))
  'lib/ is what a git install serves'
}

# ---------------------------------------------------------------- typecheck and tests
if (-not $SkipTests) {
  Check 'typecheck' {
    Push-Location $root
    try { & $pnpm typecheck | Out-Null; Need ($LASTEXITCODE -eq 0) ('typecheck exited ' + $LASTEXITCODE) }
    finally { Pop-Location }
    'tsc --noEmit'
  }
  Check 'tests' {
    Push-Location $root
    try { & $pnpm vitest run | Out-Null; Need ($LASTEXITCODE -eq 0) ('tests exited ' + $LASTEXITCODE) }
    finally { Pop-Location }
    'vitest run (includes portability and release invariants)'
  }
} else {
  $null = $skipped.Add('typecheck')
  $null = $skipped.Add('tests')
  Write-Host 'SKIP  typecheck and tests (-SkipTests)' -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------- the published release
# The installable plugin tarball is the artifact a release ships: no git, no build step for the installer.
Check 'plugin tarball builds, is complete, and matches its checksum file' {
  Push-Location $root
  try { & $node (Join-Path $root 'scripts\pack-plugin.mjs') | Out-Null; Need ($LASTEXITCODE -eq 0) ('pack-plugin exited ' + $LASTEXITCODE) }
  finally { Pop-Location }
  $tgz = Join-Path $root ('dist/dsh-superagent-' + $Version + '.tgz')
  Need (Test-Path -LiteralPath $tgz) ('pack did not produce dist/dsh-superagent-' + $Version + '.tgz')
  $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $tgz).Hash.ToLower()
  $recorded = ((Get-Content -LiteralPath ($tgz + '.sha256') -Raw).Trim() -split '\s+')[0]
  Need ($sha -eq $recorded) 'the .sha256 file next to the tarball does not match the tarball'
  $entries = & $tar -tzf $tgz
  foreach ($required in @('package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml',
      'package/prompts/team/delivery.md', 'package/skills/dsh-superagent-github/SKILL.md', 'package/locale/zh.json')) {
    Need ($entries -contains $required) ('the tarball lacks ' + $required)
  }
  Set-Variable -Name TarballDigest -Value $sha -Scope Script
  ($entries.Count.ToString() + ' entries, sha256 ' + $sha.Substring(0, 12) + '…')
}

# ---------------------------------------------------------------- the published release
if (-not $SkipOnline) {
  Check 'gh available' { Need $gh 'gh not found; pass -Gh or install the GitHub CLI'; & $gh --version | Select-Object -First 1 }

  Check ('release v' + $Version + ' carries the plugin tarball and its checksum') {
    $release = & $gh api ('repos/' + $Repo + '/releases/tags/v' + $Version) | ConvertFrom-Json
    $tgz = $release.assets | Where-Object { $_.name -like 'dsh-superagent-*.tgz' } | Select-Object -First 1
    $sum = $release.assets | Where-Object { $_.name -like '*.sha256' } | Select-Object -First 1
    Need $tgz ('release has no dsh-superagent-*.tgz asset')
    Need $sum ('release has no .sha256 asset')
    Set-Variable -Name ReleaseDigest -Value $tgz.digest -Scope Script
    ('tarball ' + [math]::Round($tgz.size / 1KB, 1) + ' KB, digest ' + $tgz.digest)
  }

  Check 'the release digest matches the tarball built here' {
    $published = ($script:ReleaseDigest -replace '^sha256:', '')
    Need ($published) 'the release asset carries no digest to compare'
    Need ($published -eq $script:TarballDigest) ('checksum mismatch: local ' + $script:TarballDigest.Substring(0, 12) + '… vs release ' + $published.Substring(0, 12) + '…')
    'the release ships exactly the artifact this checkout builds'
  }
} else {
  $null = $skipped.Add('online release checks')
  Write-Host 'SKIP  release checks (-SkipOnline)' -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------- verdict
Write-Host ''
$verdictColor = 'Green'
if ($fail.Count) { $verdictColor = 'Red' }
Write-Host ('=== ' + $pass.Count + ' passed, ' + $fail.Count + ' failed, ' + $skipped.Count + ' skipped ===') -ForegroundColor $verdictColor
if ($fail.Count) {
  Write-Host 'NOT READY TO PUBLISH:' -ForegroundColor Red
  foreach ($item in $fail) { Write-Host ('  - ' + $item) -ForegroundColor Red }
  exit 1
}
if ($skipped.Count) {
  Write-Host ('NOT VERIFIED - skipped: ' + ($skipped -join ', ')) -ForegroundColor Yellow
  Write-Host 'This checkout is not proven ready to publish; rerun without -SkipTests / -SkipOnline for a verdict.' -ForegroundColor Yellow
  exit 2
}
Write-Host 'READY TO PUBLISH.' -ForegroundColor Green
Write-Host 'Remaining manual steps (docs/020): start the app and confirm setup runs, open the panel guide, and install the tarball into a clean profile.'
exit 0
