# Send a message to a VS Code window by pasting from clipboard and pressing Enter
# Same logic as ClaudeAutoResponse PermissionMonitorService.SendMessageToClaudeCode

param(
    [Parameter(Mandatory=$true)]
    [int64]$Handle,

    [Parameter(Mandatory=$true)]
    [string]$Message
)

# Add Win32 API types
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
"@

# Validate window handle
$hwnd = [IntPtr]$Handle
if (-not [Win32]::IsWindow($hwnd)) {
    Write-Error "Invalid window handle: $Handle"
    exit 1
}

# Save original foreground window
$original = [Win32]::GetForegroundWindow()

try {
    # Copy message to clipboard
    Set-Clipboard -Value $Message

    # Focus target window
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 150

    # Verify focus changed
    if ([Win32]::GetForegroundWindow() -ne $hwnd) {
        Write-Error "Failed to focus window"
        exit 1
    }

    # Wait for window to be ready
    Start-Sleep -Milliseconds 100

    # Send Ctrl+V (paste)
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 100

    # Send Enter (submit)
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 50

    # Restore original foreground window
    if ($original -ne [IntPtr]::Zero -and $original -ne $hwnd) {
        Start-Sleep -Milliseconds 100
        [Win32]::SetForegroundWindow($original) | Out-Null
    }

    Write-Output "Message sent successfully"
    exit 0
}
catch {
    Write-Error "Failed to send message: $_"
    exit 1
}
