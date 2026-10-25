# Raster versions of the existing favicon ship mark; run on Windows to regenerate.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '../public/icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null

function Write-AppIcon([string] $FileName, [int] $Size, [float] $ArtScale = 1) {
    $canvasSize = $Size * 3
    $canvas = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $background = [System.Drawing.ColorTranslator]::FromHtml('#102b3b')
    $hullBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#e7f1ed'))
    $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#65dae0'))
    $wavePen = [System.Drawing.Pen]::new($accentBrush, 3)
    $wave = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $output = [System.Drawing.Bitmap]::new($Size, $Size)
    $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
    try {
        $graphics.Clear($background)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.ScaleTransform($canvasSize / 64, $canvasSize / 64)
        $graphics.TranslateTransform(32 * (1 - $ArtScale), 32 * (1 - $ArtScale))
        $graphics.ScaleTransform($ArtScale, $ArtScale)
        $hull = [System.Drawing.PointF[]]@(
            [System.Drawing.PointF]::new(13, 33), [System.Drawing.PointF]::new(51, 33),
            [System.Drawing.PointF]::new(42, 47), [System.Drawing.PointF]::new(24, 47)
        )
        $graphics.FillPolygon($hullBrush, $hull)
        $graphics.FillRectangle($accentBrush, 27, 19, 13, 14)
        $wave.AddBezier(13, 51, 17.6667, 47, 22, 47, 26, 51)
        $wave.AddBezier(26, 51, 30, 55, 34.3333, 55, 39, 51)
        $wave.AddBezier(39, 51, 43.6667, 47, 48, 47, 52, 51)
        $graphics.DrawPath($wavePen, $wave)
        $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $outputGraphics.DrawImage($canvas, 0, 0, $Size, $Size)
        $output.Save((Join-Path $iconDirectory $FileName), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $outputGraphics.Dispose()
        $output.Dispose()
        $wave.Dispose()
        $wavePen.Dispose()
        $accentBrush.Dispose()
        $hullBrush.Dispose()
        $graphics.Dispose()
        $canvas.Dispose()
    }
}

Write-AppIcon 'icon-192.png' 192
Write-AppIcon 'icon-512.png' 512
# Keep the complete mark inside the circular safe area for Android icon masks.
Write-AppIcon 'icon-maskable-512.png' 512 0.8
Write-AppIcon 'apple-touch-icon.png' 180
