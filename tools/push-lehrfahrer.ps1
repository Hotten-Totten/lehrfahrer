[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$DeployUrl = "https://www.lehrfahrer.de"

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git-Befehl fehlgeschlagen: git $($Arguments -join ' ')"
    }
    return $output
}

function Confirm-Action {
    param([string]$Prompt)
    return (Read-Host "$Prompt (j/N)").Trim() -match "^(j|ja|y|yes)$"
}

function Get-TrackingState {
    & git rev-parse --abbrev-ref --symbolic-full-name "@{u}" *> $null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    $counts = ((Invoke-Git rev-list --left-right --count "HEAD...@{u}") -join "").Trim() -split "\s+"
    return @{
        Ahead  = [int]$counts[0]
        Behind = [int]$counts[1]
    }
}

function Show-RepositoryStatus {
    $branch = ((Invoke-Git branch --show-current) -join "").Trim()
    $lastCommit = (Invoke-Git log -1 --oneline) -join ""
    $changes = @(Invoke-Git status --short)
    $tracking = Get-TrackingState

    Write-Host "`nBranch: $branch" -ForegroundColor Cyan
    Write-Host ("Working Tree: " + $(if ($changes.Count) { "$($changes.Count) Aenderung(en)" } else { "sauber" }))
    if ($tracking) {
        Write-Host "Ahead/Behind: $($tracking.Ahead)/$($tracking.Behind)"
    } else {
        Write-Host "Ahead/Behind: kein Upstream" -ForegroundColor Yellow
    }
    Write-Host "Letzter Commit: $lastCommit"

    if ($changes.Count) {
        Write-Host "`nAenderungen:"
        $changes | ForEach-Object { Write-Host "  $_" }
    }
}

function Test-GitHubCli {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Host "GitHub CLI nicht installiert, Actions-Status kann nicht automatisch geprueft werden." -ForegroundColor Yellow
        return $false
    }

    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GitHub CLI ist nicht angemeldet. Bitte zuerst 'gh auth login' ausfuehren." -ForegroundColor Yellow
        return $false
    }
    return $true
}

function Watch-Deployment {
    param([string]$CommitHash = "")

    if (-not (Test-GitHubCli)) {
        return
    }

    Write-Host "`nWorkflow-Run wird gesucht ..." -ForegroundColor Cyan
    $run = $null
    for ($attempt = 1; $attempt -le 10 -and -not $run; $attempt++) {
        $arguments = @("run", "list", "--limit", "1", "--json", "databaseId,status,conclusion,url,workflowName,headSha")
        if ($CommitHash) {
            $arguments += @("--commit", $CommitHash)
        }

        $runJson = & gh @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Actions konnte nicht abgefragt werden."
        }
        $runs = @($runJson | ConvertFrom-Json)
        if ($runs.Count) {
            $run = $runs[0]
        } elseif ($CommitHash) {
            Start-Sleep -Seconds 3
        } else {
            break
        }
    }

    if (-not $run) {
        Write-Host "Kein passender Workflow-Run gefunden." -ForegroundColor Yellow
        return
    }

    Write-Host "Workflow: $($run.workflowName)"
    Write-Host "Status: $($run.status)"
    Write-Host "Commit: $($run.headSha)"
    Write-Host "URL: $($run.url)"

    if ($run.status -ne "completed") {
        Write-Host "Warte auf Abschluss ..." -ForegroundColor Cyan
        & gh run watch $run.databaseId --exit-status
        $watchExitCode = $LASTEXITCODE
    } else {
        $watchExitCode = if ($run.conclusion -eq "success") { 0 } else { 1 }
    }

    $resultJson = & gh run view $run.databaseId --json status,conclusion,url,workflowName
    if ($LASTEXITCODE -ne 0) {
        throw "Das Workflow-Ergebnis konnte nicht geladen werden."
    }
    $result = $resultJson | ConvertFrom-Json

    if ($watchExitCode -eq 0 -and $result.conclusion -eq "success") {
        Write-Host "Deployment erfolgreich." -ForegroundColor Green
        if (Confirm-Action "Lehrfahrer-Webseite im Browser oeffnen?") {
            Start-Process $DeployUrl
        }
        return
    }

    Write-Host "Deployment fehlgeschlagen: $($result.conclusion)" -ForegroundColor Red
    Write-Host "URL: $($result.url)"
}

function Commit-AndPush {
    Write-Host "`nAktuelle Aenderungen:" -ForegroundColor Cyan
    $changes = @(Invoke-Git status --short)
    if ($changes.Count) {
        $changes | ForEach-Object { Write-Host "  $_" }
        $message = (Read-Host "Commit-Message (leer = abbrechen)").Trim()
        if ([string]::IsNullOrWhiteSpace($message)) {
            Write-Host "Abgebrochen." -ForegroundColor Yellow
            return
        }

        if (-not (Confirm-Action "Aenderungen mit dieser Nachricht committen?")) {
            Write-Host "Abgebrochen." -ForegroundColor Yellow
            return
        }

        [void](Invoke-Git add .)
        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            throw "Nach git add sind keine commitbaren Aenderungen vorhanden."
        }
        if ($LASTEXITCODE -ne 1) {
            throw "Die vorgemerkten Aenderungen konnten nicht geprueft werden."
        }
        Invoke-Git commit -m $message | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "Working Tree ist sauber. Es wird kein Commit erzeugt." -ForegroundColor Green
    }

    $tracking = Get-TrackingState
    if ($tracking -and $tracking.Ahead -eq 0) {
        Write-Host "Branch ist nicht voraus. Kein Push erforderlich." -ForegroundColor Green
        return
    }
    if (-not (Confirm-Action "Jetzt pushen?")) {
        Write-Host "Push abgebrochen." -ForegroundColor Yellow
        return
    }

    Invoke-Git push | ForEach-Object { Write-Host $_ }
    $commitHash = ((Invoke-Git rev-parse HEAD) -join "").Trim()
    Write-Host "Push erfolgreich. Commit: $commitHash" -ForegroundColor Green

    if (Confirm-Action "Deployment jetzt ueberwachen?") {
        Watch-Deployment -CommitHash $commitHash
    }
}

function Show-GitLog {
    Write-Host "`nLetzte 10 Commits:" -ForegroundColor Cyan
    Invoke-Git log -10 --oneline --decorate | ForEach-Object { Write-Host $_ }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: Git ist nicht installiert oder nicht im PATH." -ForegroundColor Red
    exit 1
}

& git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Fehler: Das Skript wurde nicht in einem Git-Repository gestartet." -ForegroundColor Red
    exit 1
}

while ($true) {
    Write-Host "`nLehrfahrer Deploy-Tool" -ForegroundColor Cyan
    Write-Host "1. Status pruefen"
    Write-Host "2. Commit + Push"
    Write-Host "3. Deployment ueberwachen"
    Write-Host "4. Git-Log anzeigen"
    Write-Host "5. Beenden"

    $choice = (Read-Host "Auswahl").Trim()
    try {
        switch ($choice) {
            "1" { Show-RepositoryStatus }
            "2" { Commit-AndPush }
            "3" { Watch-Deployment }
            "4" { Show-GitLog }
            "5" {
                Write-Host "Beendet."
                exit 0
            }
            default { Write-Host "Ungueltige Auswahl." -ForegroundColor Yellow }
        }
    } catch {
        Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    }
}
