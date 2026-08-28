param(
  [string]$Config = (Join-Path $PSScriptRoot 'config.json'),
  [switch]$CheckConfig,
  [switch]$RepairHoldingOnly,
  [string]$RouteFilename,
  [int]$MaxFiles = 0,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$DefaultConfig = [ordered]@{
  output_root = '%APPDATA%\EMLAB\Programs'
  subject_keyword = 'EM tests'
  lookback_days = 14
  max_saved_files = 20
  allowed_senders = @('rajput@fev.com', 'tandulkar@fev.com')
  allowed_extensions = @('.pdf', '.xlsm')
  create_missing_program_folders = $false
  unmatched_folder = '_email_downloads_needs_program'
  route_layout = 'project/transmission/vehicle'
  project_rules = [ordered]@{
    STLA = @('CITROEN', 'AIRCROSS')
    RNTBCI = @('RNTBCI', 'DUSTER', 'TRIBER', 'HR10', 'HR13', 'RBC', 'R1324')
  }
  dry_run = $false
}

$ProductionAllowedSenders = @('rajput@fev.com', 'tandulkar@fev.com')
$DefaultProjectRules = [ordered]@{
  STLA = @('CITROEN', 'AIRCROSS')
  RNTBCI = @('RNTBCI', 'DUSTER', 'TRIBER', 'HR10', 'HR13', 'RBC', 'R1324')
}

function Write-DefaultConfigIfMissing([string]$Path) {
  if (Test-Path -LiteralPath $Path) { return }
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $DefaultConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Merge-ProjectRules($ConfigData) {
  if (-not $ConfigData.PSObject.Properties['project_rules'] -or -not $ConfigData.project_rules) {
    $ConfigData | Add-Member -MemberType NoteProperty -Name project_rules -Value ([pscustomobject]@{}) -Force
  }
  foreach ($project in $DefaultProjectRules.Keys) {
    $existing = @()
    if ($ConfigData.project_rules.PSObject.Properties[$project]) {
      $existing = @($ConfigData.project_rules.$project)
    }
    $merged = [System.Collections.Generic.List[string]]::new()
    foreach ($keyword in @($existing + $DefaultProjectRules[$project])) {
      $text = ([string]$keyword).Trim()
      if ($text -and -not $merged.Contains($text)) { [void]$merged.Add($text) }
    }
    $ConfigData.project_rules | Add-Member -MemberType NoteProperty -Name $project -Value ([string[]]$merged) -Force
  }
  $ConfigData
}

function Expand-ConfigPath([string]$Value) {
  [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Value))
}

function Sanitize-Name([string]$Value) {
  $clean = $Value -replace '[<>:"/\\|?*\x00-\x1f]', '_'
  $clean = $clean.Trim() -replace '\s+', '_'
  $clean = $clean -replace '_+', '_'
  $clean = $clean.Trim(' ', '.')
  if ($clean) { $clean } else { 'unnamed' }
}

function Normalize-Key([string]$Value) {
  (Sanitize-Name $Value).ToUpperInvariant()
}

function Strip-KnownSuffix([string]$FileName) {
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
  $upper = $stem.ToUpperInvariant()
  foreach ($marker in @('_TRACES', '_REPORT')) {
    $pos = $upper.IndexOf($marker)
    if ($pos -ge 0) { return $stem.Substring(0, $pos) }
  }
  $stem
}

function Filename-Tokens([string]$FileName) {
  [regex]::Split((Strip-KnownSuffix $FileName).ToUpperInvariant(), '[_\W]+') | Where-Object { $_ }
}

function Extract-VehicleName([string]$FileName) {
  $stem = Strip-KnownSuffix $FileName
  $stem = $stem -replace '_?\d{4}-\d{2}-\d{2}[_-]\d{2}-\d{2}-\d{2}.*$', ''
  $parts = @($stem -split '_')
  if ($parts.Count -ge 2 -and $parts[-1] -match '^\d+$' -and $parts[-2] -match '^\d+$') {
    $parts = $parts[0..($parts.Count - 2)]
  }
  if ($parts.Count -ge 2 -and $parts[-1] -match '^\d+$' -and $parts[-2] -match '^[Vv]?\d+$') {
    $parts = $parts[0..($parts.Count - 3)]
  }
  Sanitize-Name ($parts -join '_')
}

function Extract-TransmissionBucket([string]$FileName) {
  $tokens = @(Filename-Tokens $FileName)
  if ($tokens | Where-Object { $_ -in @('MT', 'MB', 'MANUAL') }) { return 'MT' }
  if ($tokens | Where-Object { $_ -in @('AT', 'DCT', 'CVT', 'AUTOMATIC') }) { return 'AT' }
  if ($tokens | Where-Object { $_ -eq 'DET' }) { return 'DET' }
  'UNKNOWN_TRANS'
}

function Classify-Project($ConfigData, [string]$AttachmentName) {
  $haystack = Normalize-Key (Strip-KnownSuffix $AttachmentName)
  $tokens = @(Filename-Tokens $AttachmentName)
  foreach ($project in $ConfigData.project_rules.PSObject.Properties) {
    foreach ($keywordRaw in @($project.Value)) {
      $keyword = Normalize-Key ([string]$keywordRaw)
      if ($tokens -contains $keyword -or $haystack.Contains($keyword)) {
        return Sanitize-Name $project.Name
      }
    }
  }
  $outputRoot = Expand-ConfigPath ([string]$ConfigData.output_root)
  if (Test-Path -LiteralPath $outputRoot) {
    foreach ($child in Get-ChildItem -LiteralPath $outputRoot -Directory -ErrorAction SilentlyContinue) {
      $projectName = Sanitize-Name $child.Name
      if ($projectName -in @('logs', (Sanitize-Name ([string]$ConfigData.unmatched_folder)))) { continue }
      $keyword = Normalize-Key $projectName
      if ($tokens -contains $keyword -or $haystack.Contains($keyword)) { return $projectName }
    }
  }
  'UNKNOWN_PROJECT'
}

function Get-RouteParts($ConfigData, [string]$AttachmentName) {
  $values = @{
    project = Classify-Project $ConfigData $AttachmentName
    transmission = Extract-TransmissionBucket $AttachmentName
    vehicle = Extract-VehicleName $AttachmentName
  }
  $parts = @()
  foreach ($token in ([string]$ConfigData.route_layout -split '/')) {
    $key = $token.Trim().ToLowerInvariant()
    if ($values.ContainsKey($key)) { $parts += (Sanitize-Name $values[$key]) }
  }
  if ($parts.Count) { $parts } else { @($values.project) }
}

function Join-Parts([string]$Root, [string[]]$Parts) {
  $path = $Root
  foreach ($part in $Parts) { $path = Join-Path $path $part }
  $path
}

function Write-Log([string]$Level, [string]$Message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss,fff} | {1} | {2}' -f (Get-Date), $Level, $Message
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Resolve-ProgramFolder($ConfigData, [string]$AttachmentName) {
  $parts = @(Get-RouteParts $ConfigData $AttachmentName)
  $root = (Expand-ConfigPath ([string]$ConfigData.output_root))
  $projectFolder = Join-Path $root $parts[0]
  $destination = Join-Parts $root $parts

  $rootFull = [System.IO.Path]::GetFullPath($root)
  $destFull = [System.IO.Path]::GetFullPath($destination)
  if ($destFull -ne $rootFull -and -not $destFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved destination escaped output root: $destFull"
  }

  if (Test-Path -LiteralPath $projectFolder) { return $destFull }
  if ([bool]$ConfigData.create_missing_program_folders) {
    Write-Log 'WARNING' "Creating missing project folder $projectFolder. Create the same project in EMLAB so the watcher registers it."
    return $destFull
  }

  $holdingParts = @((Sanitize-Name ([string]$ConfigData.unmatched_folder))) + $parts
  $holding = Join-Parts $root $holdingParts
  Write-Log 'WARNING' "Project folder $projectFolder does not exist. Saving to holding folder $holding."
  $holding
}

function Assert-AllowedSendersConfigured($ConfigData) {
  $senders = @($ProductionAllowedSenders) | Where-Object { [string]$_ -and ([string]$_).Trim() }
  if ($senders.Count -eq 0) {
    throw 'allowed_senders must contain at least one exact sender email before Outlook automation is enabled.'
  }
}

function Get-SenderSmtpAddress($Message) {
  $raw = [string]$Message.SenderEmailAddress
  $type = try { [string]$Message.SenderEmailType } catch { '' }
  if ($type -ne 'EX') { return $raw }

  try {
    $PR_SMTP_ADDRESS = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001E'
    $smtp = $Message.PropertyAccessor.GetProperty($PR_SMTP_ADDRESS)
    if ($smtp) { return [string]$smtp }
  } catch { }

  try {
    $exUser = $Message.Sender.GetExchangeUser()
    if ($exUser -and $exUser.PrimarySmtpAddress) { return [string]$exUser.PrimarySmtpAddress }
  } catch { }

  Write-Log 'WARNING' "Could not resolve SMTP address for Exchange sender (raw: $raw)."
  $raw
}

function Get-AllowedSenders() {
  $map = @{}
  foreach ($sender in @($ProductionAllowedSenders)) {
    if ([string]$sender) { $map[([string]$sender).Trim().ToLowerInvariant()] = $true }
  }
  $map
}

function Save-ProcessedIds([string]$Path, $ProcessedMap) {
  $tempPath = "$Path.tmp"
  ([string[]]$ProcessedMap.Keys | Sort-Object | ConvertTo-Json) | Set-Content -LiteralPath $tempPath -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

function Get-UniquePath([string]$Destination) {
  if (-not (Test-Path -LiteralPath $Destination)) { return $Destination }
  $dir = Split-Path -Parent $Destination
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($Destination)
  $ext = [System.IO.Path]::GetExtension($Destination)
  $counter = 1
  while ($true) {
    $candidate = Join-Path $dir ("{0}_{1}{2}" -f $stem, $counter, $ext)
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
    $counter++
  }
}

function Repair-HoldingFolder($ConfigData) {
  $root = (Expand-ConfigPath ([string]$ConfigData.output_root))
  $holdingRoots = @()
  foreach ($folderName in @((Sanitize-Name ([string]$ConfigData.unmatched_folder)), 'email_downloads_needs_program', '_email_downloads_needs_program')) {
    $candidate = Join-Path $root (Sanitize-Name $folderName)
    if ((Test-Path -LiteralPath $candidate) -and -not ($holdingRoots -contains $candidate)) {
      $holdingRoots += $candidate
    }
  }

  $moved = 0
  $files = @()
  foreach ($holdingRoot in $holdingRoots) {
    $files += @(Get-ChildItem -LiteralPath $holdingRoot -Recurse -File -ErrorAction SilentlyContinue)
  }
  foreach ($group in ($files | Group-Object { Strip-KnownSuffix $_.Name })) {
    $pdf = @($group.Group | Where-Object { $_.Name.ToUpperInvariant().EndsWith('_REPORT.PDF') } | Select-Object -First 1)
    $xlsm = @($group.Group | Where-Object { $_.Name.ToUpperInvariant().EndsWith('_TRACES.XLSM') } | Select-Object -First 1)
    if ($pdf.Count -eq 0 -or $xlsm.Count -eq 0) {
      Write-Log 'WARNING' "Holding folder still has incomplete pair for $($group.Name)." | Out-Null
      continue
    }

    $parts = @(Get-RouteParts $ConfigData $pdf[0].Name)
    if ($parts.Count -eq 0 -or $parts[0] -eq 'UNKNOWN_PROJECT') {
      Write-Log 'WARNING' "Holding folder pair still has unknown project: $($group.Name)." | Out-Null
      continue
    }

    $destinationFolder = Join-Parts $root $parts
    $destFull = [System.IO.Path]::GetFullPath($destinationFolder)
    $insideHolding = $false
    foreach ($holdingRoot in $holdingRoots) {
      $holdingFull = [System.IO.Path]::GetFullPath($holdingRoot)
      if ($destFull.StartsWith($holdingFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        $insideHolding = $true
      }
    }
    if ($insideHolding) { continue }

    New-Item -ItemType Directory -Path $destinationFolder -Force | Out-Null
    foreach ($source in @($pdf[0], $xlsm[0])) {
      $destination = Get-UniquePath (Join-Path $destinationFolder $source.Name)
      Move-Item -LiteralPath $source.FullName -Destination $destination
      Write-Log 'INFO' "Moved holding attachment into watched project folder: $destination" | Out-Null
      $moved++
    }
  }
  $moved
}

Write-DefaultConfigIfMissing $Config
$configData = Merge-ProjectRules (Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json)
$outputRoot = Expand-ConfigPath ([string]$configData.output_root)

if ($CheckConfig) {
  Assert-AllowedSendersConfigured $configData
  Write-Output "Config OK: output_root=$outputRoot"
  exit 0
}

if ($RouteFilename) {
  Write-Output ((Get-RouteParts $configData $RouteFilename) -join '\')
  exit 0
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$logDir = Join-Path $outputRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$script:LogPath = Join-Path $logDir 'emlab_outlook_downloader.log'
Assert-AllowedSendersConfigured $configData

if ($RepairHoldingOnly) {
  $repaired = Repair-HoldingFolder $configData
  Write-Output "Repair OK: moved=$repaired"
  exit 0
}

$lockPath = Join-Path $outputRoot 'emlab_outlook_downloader.lock'
$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $bytes = [System.Text.Encoding]::ASCII.GetBytes([string]$PID)
  $lockStream.Write($bytes, 0, $bytes.Length)

  $processedPath = Join-Path $outputRoot 'processed_outlook_messages.json'
  $processed = @{}
  if (Test-Path -LiteralPath $processedPath) {
    try {
      foreach ($idRaw in @(Get-Content -LiteralPath $processedPath -Raw | ConvertFrom-Json)) {
        foreach ($id in ([regex]::Split([string]$idRaw, '\s+') | Where-Object { $_ })) {
          $processed[[string]$id] = $true
        }
      }
    } catch {
      Write-Log 'ERROR' "Could not read $processedPath`: $($_.Exception.Message)"
    }
  }

  $repaired = Repair-HoldingFolder $configData
  if ($repaired -gt 0) { Write-Log 'INFO' "Repaired holding folder attachments: moved=$repaired" }

  $lastRunPath = Join-Path $outputRoot 'last_successful_run.json'
  if (Test-Path -LiteralPath $lastRunPath) {
    try {
      $lastRunRaw = (Get-Content -LiteralPath $lastRunPath -Raw | ConvertFrom-Json).completed_utc
      $lastRunUtc = [datetime]::Parse([string]$lastRunRaw, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
      $gap = (Get-Date).ToUniversalTime() - $lastRunUtc
      if ($gap.TotalDays -gt [int]$configData.lookback_days) {
        Write-Log 'WARNING' ("Gap since last successful run was {0:N1} day(s), longer than the {1}-day lookback_days window. Emails older than the lookback window were not scanned and will not be picked up automatically -- check Outlook manually for that period if needed." -f $gap.TotalDays, [int]$configData.lookback_days)
      }
    } catch {
      Write-Log 'WARNING' "Could not read $lastRunPath`: $($_.Exception.Message)"
    }
  }

  Write-Log 'INFO' 'Connecting to Classic Outlook profile.'
  $outlook = New-Object -ComObject Outlook.Application
  $messages = $outlook.GetNamespace('MAPI').GetDefaultFolder(6).Items
  $messages.Sort('[ReceivedTime]', $true)

  $allowedExtensions = @{}
  foreach ($extRaw in @($configData.allowed_extensions)) {
    $ext = ([string]$extRaw).ToLowerInvariant()
    if (-not $ext.StartsWith('.')) { $ext = ".$ext" }
    $allowedExtensions[$ext] = $true
  }
  $allowedSenders = Get-AllowedSenders

  $cutoff = (Get-Date).AddDays(-[int]$configData.lookback_days)
  $limit = if ($MaxFiles -gt 0) { $MaxFiles } elseif ([int]$configData.max_saved_files -gt 0) { [int]$configData.max_saved_files } else { 0 }
  $effectiveDryRun = $DryRun -or [bool]$configData.dry_run
  $inspected = 0
  $matched = 0
  $saved = 0

  foreach ($message in $messages) {
    if ($limit -gt 0 -and $saved -ge $limit) { break }
    $inspected++
    try {
      if ($message.Class -ne 43) { continue }
      if ([datetime]$message.ReceivedTime -lt $cutoff) { break }
      $subject = [string]$message.Subject
      if ($subject.ToLowerInvariant().IndexOf(([string]$configData.subject_keyword).ToLowerInvariant()) -lt 0) { continue }
      $senderAddress = (Get-SenderSmtpAddress $message).Trim().ToLowerInvariant()
      if ($allowedSenders.Count -gt 0 -and -not $allowedSenders.ContainsKey($senderAddress)) { continue }
      $entryId = [string]$message.EntryID
      if ($processed.ContainsKey($entryId)) { continue }

      $matched++
      $savedFromMessage = 0
      $completePairs = 0
      $limitReached = $false
      $candidates = @()
      for ($i = 1; $i -le $message.Attachments.Count; $i++) {
        $attachment = $message.Attachments.Item($i)
        $originalName = [string]$attachment.FileName
        $safeName = Sanitize-Name $originalName
        $extension = [System.IO.Path]::GetExtension($safeName).ToLowerInvariant()
        if (-not $allowedExtensions.ContainsKey($extension)) {
          Write-Log 'INFO' "Skipped unsupported attachment: $originalName"
          continue
        }

        $candidates += [pscustomobject]@{
          Attachment = $attachment
          OriginalName = $originalName
          SafeName = $safeName
          Extension = $extension
          Stem = Strip-KnownSuffix $safeName
        }
      }

      foreach ($group in ($candidates | Group-Object Stem)) {
        $pdf = @($group.Group | Where-Object { $_.Extension -eq '.pdf' } | Select-Object -First 1)
        $xlsm = @($group.Group | Where-Object { $_.Extension -eq '.xlsm' } | Select-Object -First 1)
        if ($pdf.Count -eq 0 -or $xlsm.Count -eq 0) {
          Write-Log 'WARNING' "Skipped incomplete attachment set for $($group.Name). PDF and XLSM are both required."
          continue
        }

        $planned = @()
        foreach ($candidate in @($pdf[0], $xlsm[0])) {
          $destinationFolder = Resolve-ProgramFolder $configData $candidate.SafeName
          $exactDestination = Join-Path $destinationFolder $candidate.SafeName
          $planned += [pscustomobject]@{
            Candidate = $candidate
            DestinationFolder = $destinationFolder
            ExactDestination = $exactDestination
            Exists = Test-Path -LiteralPath $exactDestination
          }
        }

        $newFiles = @($planned | Where-Object { -not $_.Exists }).Count
        if ($limit -gt 0 -and ($saved + $newFiles) -gt $limit) {
          Write-Log 'WARNING' "Skipped complete attachment set for $($group.Name) because max_saved_files would be exceeded. Will retry next run."
          $limitReached = $true
          break
        }

        $completePairs++
        foreach ($item in $planned) {
          if ($item.Exists) {
            Write-Log 'INFO' "Skipped existing attachment: $($item.ExactDestination)"
            $savedFromMessage++
            continue
          }
          $destination = Get-UniquePath $item.ExactDestination
          if ($effectiveDryRun) {
            Write-Log 'INFO' "Dry run: would save $destination"
          } else {
            New-Item -ItemType Directory -Path $item.DestinationFolder -Force | Out-Null
            $item.Candidate.Attachment.SaveAsFile($destination)
            Write-Log 'INFO' "Saved attachment: $destination"
          }
          $saved++
          $savedFromMessage++
        }
      }

      if (-not $limitReached) {
        $processed[$entryId] = $true
        if (-not $effectiveDryRun) {
          Save-ProcessedIds $processedPath $processed
        }
      }
      if ($candidates.Count -eq 0) { Write-Log 'WARNING' 'Matched message had no allowed PDF/XLSM attachments.' }
      elseif ($completePairs -eq 0 -and -not $limitReached) { Write-Log 'WARNING' 'Matched message had allowed attachments, but no complete PDF/XLSM pair.' }
    } catch {
      Write-Log 'ERROR' "Failed while processing an Outlook message: $($_.Exception.Message)"
    }
  }

  $limitText = if ($limit -gt 0) { [string]$limit } else { '' }
  Write-Log 'INFO' "Completed. inspected=$inspected matched=$matched attachments_saved=$saved max_saved_files=$limitText"
  if (-not $effectiveDryRun) {
    $lastRunTemp = "$lastRunPath.tmp"
    (@{ completed_utc = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json) | Set-Content -LiteralPath $lastRunTemp -Encoding UTF8
    Move-Item -LiteralPath $lastRunTemp -Destination $lastRunPath -Force
  }
} finally {
  if ($lockStream) { $lockStream.Close() }
  Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue
}
