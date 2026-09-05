$projectRoot = "E:\Users\rclt\Desktop\Starst_Desk"
$electronExe = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
$iconPath = Join-Path $projectRoot "resources\icon.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Starst Desk.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronExe
$shortcut.Arguments = "`"$projectRoot`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath, 0"
$shortcut.Description = "Starst Desk - Windows 11 桌面助手"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "快捷方式已创建: $shortcutPath"
Write-Output "目标: $electronExe"
Write-Output "参数: $projectRoot"
Write-Output "图标: $iconPath"