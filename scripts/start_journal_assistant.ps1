$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $workspacePath 'server'
$pythonPath = Join-Path $workspacePath '.venv\Scripts\python.exe'
$logPath = Join-Path $workspacePath '.cache'

function Test-AssistantBackend {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
        if ($health.status -ne 'ok') { return $false }
        $schema = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 2
        return ($null -ne $schema.paths.PSObject.Properties['/journal'])
    } catch { return $false }
}

try {
    if (-not (Test-AssistantBackend)) {
        if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
            throw 'Port 8000 already has a different or older backend. Restart the Browser Assistant backend, then open this shortcut again.'
        }
        if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Browser Assistant Python environment was not found.' }
        New-Item -ItemType Directory -Path $logPath -Force | Out-Null
        Start-Process -FilePath $pythonPath -ArgumentList 'main.py' -WorkingDirectory $serverPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'journal-launch.stdout.log') -RedirectStandardError (Join-Path $logPath 'journal-launch.stderr.log') | Out-Null
        $backendReady = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            if (Test-AssistantBackend) { $backendReady = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $backendReady) { throw "Backend could not start. See the journal-launch logs in $logPath." }
    }
    $chromePath = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
    $pageUrl = 'https://admissions.aurora.edu.in/modules/assessments/assessments'
    if (Test-Path -LiteralPath $chromePath) {
        Start-Process -FilePath $chromePath -ArgumentList $pageUrl | Out-Null
    } else {
        Start-Process $pageUrl | Out-Null
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Journal Assistant') | Out-Null
    exit 1
}
