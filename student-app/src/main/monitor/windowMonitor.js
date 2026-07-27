// Window Monitor — Uses PowerShell to enumerate open windows
const { exec } = require('child_process');
const path = require('path');

let monitorInterval = null;
let activeWindowInterval = null;
let currentActivity = {
  activeApp: null,
  activeTitle: null,
  openWindows: [],
  totalWindows: 0,
  totalTabs: 0,
  timestamp: null,
};

// Track per-app timing
let appTimers = {}; // { appName: { openSince, activeSince, totalOpen, totalActive } }
let lastActiveApp = null;

// PowerShell command to get all visible windows
const PS_GET_WINDOWS = `
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | 
Select-Object ProcessName, MainWindowTitle, Id | 
ConvertTo-Json -Compress
`.trim().replace(/\n/g, ' ');

// PowerShell command to get foreground window
const PS_GET_ACTIVE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [WinAPI]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][WinAPI]::GetWindowText($hwnd, $sb, 256)
$pid = 0
[void][WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
@{ Title = $sb.ToString(); ProcessName = $proc.ProcessName; PID = $pid } | ConvertTo-Json -Compress
`.trim().replace(/\n/g, ' ');

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`,
      { timeout: 10000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

async function getActiveWindow() {
  try {
    const result = await runPowerShell(PS_GET_ACTIVE);
    if (result) {
      return {
        appName: result.ProcessName || 'Unknown',
        windowTitle: result.Title || '',
        pid: result.PID,
      };
    }
  } catch (e) {
    // Fallback: silent fail
  }
  return null;
}

async function getAllWindows() {
  try {
    let result = await runPowerShell(PS_GET_WINDOWS);
    if (!result) return [];
    if (!Array.isArray(result)) result = [result];

    return result.map((w) => ({
      appName: w.ProcessName || 'Unknown',
      windowTitle: w.MainWindowTitle || '',
      pid: w.Id,
    }));
  } catch (e) {
    return [];
  }
}

function isBrowser(appName) {
  const browsers = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'];
  return browsers.some((b) => (appName || '').toLowerCase().includes(b));
}

function updateAppTimers(activeWindow, allWindows) {
  const now = Date.now();

  // Track all open apps
  const currentApps = new Set();
  for (const win of allWindows) {
    const key = win.appName;
    currentApps.add(key);

    if (!appTimers[key]) {
      appTimers[key] = {
        appName: key,
        windowTitle: win.windowTitle,
        openSince: now,
        activeSince: null,
        totalOpenMs: 0,
        totalActiveMs: 0,
      };
    }
    appTimers[key].windowTitle = win.windowTitle;
  }

  // Mark closed apps
  for (const key of Object.keys(appTimers)) {
    if (!currentApps.has(key)) {
      // App closed — finalize timing
      const timer = appTimers[key];
      if (timer.openSince) {
        timer.totalOpenMs += now - timer.openSince;
        timer.openSince = null;
      }
      if (timer.activeSince) {
        timer.totalActiveMs += now - timer.activeSince;
        timer.activeSince = null;
      }
    }
  }

  // Update active window timing
  if (activeWindow) {
    const activeKey = activeWindow.appName;

    // Deactivate previous active
    if (lastActiveApp && lastActiveApp !== activeKey && appTimers[lastActiveApp]) {
      const prevTimer = appTimers[lastActiveApp];
      if (prevTimer.activeSince) {
        prevTimer.totalActiveMs += now - prevTimer.activeSince;
        prevTimer.activeSince = null;
      }
    }

    // Activate current
    if (appTimers[activeKey] && !appTimers[activeKey].activeSince) {
      appTimers[activeKey].activeSince = now;
    }

    lastActiveApp = activeKey;
  }
}

function getAppUsageSummary() {
  const now = Date.now();
  const summary = [];

  for (const [key, timer] of Object.entries(appTimers)) {
    let openMs = timer.totalOpenMs;
    let activeMs = timer.totalActiveMs;

    if (timer.openSince) openMs += now - timer.openSince;
    if (timer.activeSince) activeMs += now - timer.activeSince;

    summary.push({
      appName: key,
      windowTitle: timer.windowTitle,
      openSeconds: Math.round(openMs / 1000),
      activeSeconds: Math.round(activeMs / 1000),
    });
  }

  return summary;
}

function resetAppTimers() {
  appTimers = {};
  lastActiveApp = null;
}

async function pollActivity() {
  try {
    const [activeWindow, allWindows] = await Promise.all([
      getActiveWindow(),
      getAllWindows(),
    ]);

    const browserTabs = allWindows.filter((w) => isBrowser(w.appName));

    updateAppTimers(activeWindow, allWindows);

    currentActivity = {
      activeApp: activeWindow?.appName || null,
      activeTitle: activeWindow?.windowTitle || null,
      openWindows: allWindows,
      totalWindows: allWindows.length,
      totalTabs: browserTabs.length,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    console.error('Error polling activity:', e);
  }
}

function setupMonitoring(store, mainWindow) {
  // Poll active window every 5 seconds
  activeWindowInterval = setInterval(async () => {
    await pollActivity();

    // Send to renderer for UI display
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('activity:update', currentActivity);
    }
  }, 5000);

  // Initial poll
  pollActivity();

  console.log('🖥️ Window monitoring started');
}

function stopMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  if (activeWindowInterval) clearInterval(activeWindowInterval);
  monitorInterval = null;
  activeWindowInterval = null;
  console.log('🖥️ Window monitoring stopped');
}

function getCurrentActivity() {
  return currentActivity;
}

module.exports = {
  setupMonitoring,
  stopMonitoring,
  getCurrentActivity,
  getAppUsageSummary,
  resetAppTimers,
};
