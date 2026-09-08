# repack.ps1 — 把 chrome-extension/ 打包为 doubao-downloader-plus.zip
# 用 .NET ZipArchive 显式写 "chrome-extension/" 正斜杠 entry（兼容 unzip 及跨平台解压）
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $Root "chrome-extension"
$dest = Join-Path $Root "doubao-downloader-plus.zip"

if (Test-Path $dest) { Remove-Item $dest -Force }

$zip = [System.IO.Compression.ZipFile]::Open($dest, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $src -File | ForEach-Object {
    $entryName = "chrome-extension/" + $_.Name
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $in = [System.IO.File]::OpenRead($_.FullName)
    try {
      $out = $entry.Open()
      try { $in.CopyTo($out) } finally { $out.Dispose() }
    } finally { $in.Dispose() }
  }
} finally {
  $zip.Dispose()
}

Write-Host "repacked: $dest"
