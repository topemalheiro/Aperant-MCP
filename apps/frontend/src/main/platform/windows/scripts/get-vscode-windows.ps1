# Get all VS Code windows with their handles and titles
# Same logic as ClaudeAutoResponse MainViewModel

$windows = @()

Get-Process -Name "Code" -ErrorAction SilentlyContinue |
Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
ForEach-Object {
    $windows += @{
        handle = $_.MainWindowHandle.ToInt64()
        title = $_.MainWindowTitle
        processId = $_.Id
    }
}

if ($windows.Count -eq 0) {
    Write-Output "[]"
} elseif ($windows.Count -eq 1) {
    # Single item needs to be wrapped in array for JSON
    Write-Output ("[" + ($windows[0] | ConvertTo-Json -Compress) + "]")
} else {
    $windows | ConvertTo-Json -Compress
}
