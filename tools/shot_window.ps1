Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$sig = @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rr, B; }
}
"@
Add-Type $sig
$p = Get-Process hongguo-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no process"; exit 1 }
[void][W]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 700
$r = New-Object W+R
[void][W]::GetWindowRect($p.MainWindowHandle, [ref]$r)
$w = $r.Rr - $r.L; $h = $r.B - $r.T
Write-Output "rect=$($r.L),$($r.T) ${w}x${h}"
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $h))
$out = "D:\IDEA\hongguo-destop\shots-new\shell-first-run.png"
$bmp.Save($out)
Write-Output "saved=$out"
