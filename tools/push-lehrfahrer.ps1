[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Stop-WithError {
    param([string]$Message)
    Write-Host "Fehler: $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "Git-Befehl fehlgeschlagen: git $($Arguments -join ' ')"
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithError "Git ist nicht installiert oder nicht im PATH."
}

& git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Das Skript wurde nicht in einem Git-Repository gestartet."
}

Write-Host "`nGit-Status:" -ForegroundColor Cyan
Invoke-Git status

$shortStatus = @(& git status --short)
if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Der Git-Status konnte nicht gelesen werden."
}

$commitCreated = $false
if ($shortStatus.Count -gt 0) {
    $message = (Read-Host "Commit-Message eingeben (leer = abbrechen)").Trim()
    if ([string]::IsNullOrWhiteSpace($message)) {
        Write-Host "Abgebrochen. Es wurde nichts committed oder gepusht." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "`nDateien werden vorgemerkt ..." -ForegroundColor Cyan
    Invoke-Git add .

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Stop-WithError "Nach git add sind keine commitbaren Änderungen vorhanden."
    }
    if ($LASTEXITCODE -ne 1) {
        Stop-WithError "Die vorgemerkten Änderungen konnten nicht geprüft werden."
    }

    Invoke-Git commit -m $message
    $commitCreated = $true
} else {
    Write-Host "Working Tree ist sauber. Es wird kein Commit erzeugt." -ForegroundColor Green
}

$shouldPush = $commitCreated
if (-not $shouldPush) {
    & git rev-parse --abbrev-ref --symbolic-full-name "@{u}" *> $null
    if ($LASTEXITCODE -eq 0) {
        $aheadText = & git rev-list --count "@{u}..HEAD"
        if ($LASTEXITCODE -ne 0) {
            Stop-WithError "Der Abstand zum Upstream konnte nicht ermittelt werden."
        }
        $ahead = [int]($aheadText | Select-Object -First 1)
        $shouldPush = $ahead -gt 0
        if (-not $shouldPush) {
            Write-Host "Branch ist nicht voraus. Kein Push erforderlich." -ForegroundColor Green
        }
    } else {
        Write-Host "Kein Upstream-Branch konfiguriert. Kein automatischer Push." -ForegroundColor Yellow
    }
}

if (-not $shouldPush) {
    exit 0
}

Write-Host "`nPush wird ausgeführt ..." -ForegroundColor Cyan
Invoke-Git push
$commitHash = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Der aktuelle Commit-Hash konnte nicht ermittelt werden."
}

Write-Host "Push erfolgreich." -ForegroundColor Green
Write-Host "Commit: $commitHash"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "GitHub CLI nicht installiert, Actions-Status kann nicht automatisch geprüft werden." -ForegroundColor Yellow
    exit 0
}

Write-Host "`nGitHub Actions: Workflow-Run wird gesucht ..." -ForegroundColor Cyan
$run = $null
for ($attempt = 1; $attempt -le 10 -and -not $run; $attempt++) {
    $runJson = & gh run list --commit $commitHash --limit 1 --json databaseId,status,conclusion,url,workflowName
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "GitHub Actions konnte nicht abgefragt werden."
    }
    $runs = @($runJson | ConvertFrom-Json)
    if ($runs.Count -gt 0) {
        $run = $runs[0]
        break
    }
    Start-Sleep -Seconds 3
}

if (-not $run) {
    Write-Host "Für diesen Commit wurde noch kein Workflow-Run gefunden." -ForegroundColor Yellow
    exit 0
}

Write-Host "Workflow: $($run.workflowName)"
Write-Host "Status: $($run.status)"
Write-Host "URL: $($run.url)"
Write-Host "Warte auf Abschluss ..." -ForegroundColor Cyan

& gh run watch $run.databaseId --exit-status
$watchExitCode = $LASTEXITCODE

$resultJson = & gh run view $run.databaseId --json status,conclusion,url,workflowName
if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Das Workflow-Ergebnis konnte nicht geladen werden."
}
$result = $resultJson | ConvertFrom-Json
$conclusion = if ($result.conclusion) { $result.conclusion } else { $result.status }

if ($watchExitCode -eq 0 -and $result.conclusion -eq "success") {
    Write-Host "GitHub Actions erfolgreich: success" -ForegroundColor Green
    exit 0
}

Write-Host "GitHub Actions fehlgeschlagen: $conclusion" -ForegroundColor Red
Write-Host "URL: $($result.url)"
exit 1
