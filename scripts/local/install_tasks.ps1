# Registers the backup tasks and the overseer described in README.md (re-running replaces them).
# From WSL:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w scripts/local/install_tasks.ps1)"
$cmd = "--headless wsl.exe -d Ubuntu-24.04 -u berub -- bash /home/berub/.local/bin/patinoire_job.sh"
$night = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "$cmd night"
$morn  = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "$cmd morning"
$sN = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 17) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$sM = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Patinoire - Ce soir" -Action $night -Trigger (New-ScheduledTaskTrigger -Daily -At 12:05PM) -Settings $sN -Force | Out-Null
Register-ScheduledTask -TaskName "Patinoire - Classement" -Action $morn -Trigger (New-ScheduledTaskTrigger -Daily -At 4:30AM) -Settings $sM -Force | Out-Null
# The overseer: every 30 minutes, check the site and re-run whatever fell behind (overseer.sh)
$watch = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless wsl.exe -d Ubuntu-24.04 -u berub -- bash /home/berub/.local/bin/patinoire_overseer.sh"
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30)
$sW = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Patinoire - Surveillance" -Action $watch -Trigger $every -Settings $sW -Force | Out-Null
Get-ScheduledTask -TaskName "Patinoire*" | ForEach-Object { "{0}: {1}, next run {2}" -f $_.TaskName, $_.State, (Get-ScheduledTaskInfo $_).NextRunTime }
