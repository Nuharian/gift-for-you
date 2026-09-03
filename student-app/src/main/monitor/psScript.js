// The PowerShell worker script used to enumerate windows.
// Kept as a string and written to userData at runtime so it also works from
// inside app.asar (PowerShell cannot execute a file packed in an archive).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class GfyWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextLengthW(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr hWnd);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLongW(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);

    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const uint GW_OWNER = 4;
    const uint GW_HWNDNEXT = 2;

    public class Win { public string Title; public uint Pid; public bool Active; public bool Minimized; public int Z; }

    static string TitleOf(IntPtr h) {
        int len = GetWindowTextLengthW(h);
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 2);
        GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    // Walks top-level windows in z-order. No delegate marshalling, so it cannot
    // fault the host PowerShell process the way an EnumWindows callback can.
    public static List<Win> List() {
        IntPtr fg = GetForegroundWindow();
        List<Win> res = new List<Win>();
        IntPtr h = GetTopWindow(IntPtr.Zero);
        int guard = 0;
        int z = 0;
        while (h != IntPtr.Zero && guard++ < 5000) {
            if (IsWindowVisible(h) && GetWindow(h, GW_OWNER) == IntPtr.Zero
                && (GetWindowLongW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) == 0) {
                string t = TitleOf(h);
                if (t.Length > 0) {
                    uint pid; GetWindowThreadProcessId(h, out pid);
                    Win w = new Win();
                    w.Title = t; w.Pid = pid; w.Active = (h == fg); w.Minimized = IsIconic(h); w.Z = z++;
                    res.Add(w);
                }
            }
            h = GetWindow(h, GW_HWNDNEXT);
        }
        return res;
    }
}
"@

function Get-Snapshot {
  $wins = [GfyWin]::List()
  $procNames = @{}
  foreach ($p in (Get-Process)) { $procNames[[uint32]$p.Id] = $p.ProcessName }
  $out = New-Object System.Collections.ArrayList
  foreach ($w in $wins) {
    $name = $procNames[[uint32]$w.Pid]
    if (-not $name) { $name = 'Unknown' }
    [void]$out.Add([pscustomobject]@{
      a = $name
      t = $w.Title
      p = [int]$w.Pid
      f = [bool]$w.Active
      m = [bool]$w.Minimized
      z = [int]$w.Z
    })
  }
  return $out
}

[Console]::Out.WriteLine("READY")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'QUIT') { break }
  if ($line -eq 'POLL') {
    try {
      $snap = @(Get-Snapshot)
      $json = ConvertTo-Json -InputObject $snap -Compress -Depth 3
      # ConvertTo-Json unwraps single-element arrays; Node re-wraps when needed.
      if ($null -eq $json -or $json.Length -eq 0) { $json = '[]' }
      [Console]::Out.WriteLine("DATA " + $json)
    } catch {
      [Console]::Out.WriteLine("ERR " + $_.Exception.Message)
    }
  }
}
`.trim();

// Writes the script next to the app's config and returns its path. Rewritten
// whenever the content changes so an app update always ships a fresh worker.
function ensureScriptFile(userDataDir) {
  const hash = crypto.createHash('sha1').update(PS_SCRIPT).digest('hex').slice(0, 8);
  const file = path.join(userDataDir, `gfy-monitor-${hash}.ps1`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '\ufeff' + PS_SCRIPT, 'utf8');
    // Clean up worker scripts left behind by previous versions.
    try {
      for (const name of fs.readdirSync(userDataDir)) {
        if (/^gfy-monitor-[0-9a-f]{8}\.ps1$/.test(name) && path.join(userDataDir, name) !== file) {
          fs.unlinkSync(path.join(userDataDir, name));
        }
      }
    } catch { /* best effort */ }
  }
  return file;
}

module.exports = { PS_SCRIPT, ensureScriptFile };
