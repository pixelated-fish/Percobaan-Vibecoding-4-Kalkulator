# Server statis sederhana untuk menguji kalkulator di browser.
# Pemakaian: powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 5500
param(
  [int]$Port = 5500,
  [string]$Root = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

Write-Output "Menjalankan server di http://localhost:$Port/ (root: $rootPath)"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  try {
    $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }

    $resolved = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relative))
    if (-not $resolved.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      $response.StatusCode = 403
      $response.Close()
      continue
    }

    if ([System.IO.Directory]::Exists($resolved)) {
      $resolved = Join-Path $resolved 'index.html'
    }

    if (-not [System.IO.File]::Exists($resolved)) {
      $response.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $response.ContentType = 'text/plain; charset=utf-8'
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.Close()
      continue
    }

    $extension = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
    $contentType = $mime[$extension]
    if (-not $contentType) { $contentType = 'application/octet-stream' }

    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    $response.ContentType = $contentType
    $response.Headers.Add('Cache-Control', 'no-store')
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
    Write-Output "200 $relative"
  } catch {
    try {
      $response.StatusCode = 500
      $response.Close()
    } catch { }
    Write-Output "500 $($request.Url.AbsolutePath) - $($_.Exception.Message)"
  }
}
