# Reads what's playing on this PC from Windows' media controls (the same info
# as the volume flyout: Spotify, Apple Music, browsers...) and prints one JSON
# line whenever it changes. Commands arrive on stdin, one per line:
#   toggle | play | pause | next | prev | seek <seconds>
# Started by desktop/system-media.cjs. Read-only apart from those commands.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(3000)) { throw 'timed out' }
  $t.Result
}

$skip = @($env:LP_OWN_AUMID, 'electron', 'lyric') | Where-Object { $_ }
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastJson = ''
$lastTrack = ''
$thumb = $null
$session = $null

function Pick-Session {
  $all = @($mgr.GetSessions() | Where-Object {
    $id = $_.SourceAppUserModelId.ToLower()
    -not ($skip | Where-Object { $id.Contains($_.ToLower()) })
  })
  if (-not $all.Count) { return $null }
  $cur = $mgr.GetCurrentSession()
  $playing = @($all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' })
  if ($cur -and ($playing | Where-Object { $_.SourceAppUserModelId -eq $cur.SourceAppUserModelId })) { return $cur }
  if ($playing.Count) { return $playing[0] }
  if ($cur -and ($all | Where-Object { $_.SourceAppUserModelId -eq $cur.SourceAppUserModelId })) { return $cur }
  return $all[0]
}

function Read-Thumb($ref) {
  if (-not $ref) { return $null }
  try {
    $s = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [uint32]$s.Size
    if ($size -le 0 -or $size -gt 4MB) { return $null }
    $r = New-Object Windows.Storage.Streams.DataReader($s.GetInputStreamAt(0))
    $null = Await ($r.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $r.ReadBytes($bytes)
    $type = if ($s.ContentType) { $s.ContentType } else { 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

while ($true) {
  try {
    if ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { break } # the app closed
      $pending = $stdin.ReadLineAsync()
      if ($session) {
        $parts = $line.Trim().Split(' ')
        switch ($parts[0]) {
          'toggle' { $null = $session.TryTogglePlayPauseAsync() }
          'play' { $null = $session.TryPlayAsync() }
          'pause' { $null = $session.TryPauseAsync() }
          'next' { $null = $session.TrySkipNextAsync() }
          'prev' { $null = $session.TrySkipPreviousAsync() }
          'seek' { $null = $session.TryChangePlaybackPositionAsync([long]([double]$parts[1] * 10000000)) }
        }
      }
    }

    $session = Pick-Session
    if (-not $session) {
      $out = '{"none":true}'
    } else {
      $p = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $session.GetPlaybackInfo()
      $tl = $session.GetTimelineProperties()
      $track = "$($session.SourceAppUserModelId)|$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
      $newThumb = $false
      if ($track -ne $lastTrack) {
        $lastTrack = $track
        $thumb = Read-Thumb $p.Thumbnail
        $newThumb = $true
      } elseif (-not $thumb -and $p.Thumbnail) {
        $thumb = Read-Thumb $p.Thumbnail # some apps add the cover a moment later
        $newThumb = [bool]$thumb
      }
      if ($newThumb) {
        # The cover goes out once per song, on its own line (it's large).
        [Console]::Out.WriteLine((([ordered]@{ thumbFor = $track; thumb = $thumb }) | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
      }
      $o = [ordered]@{
        app = $session.SourceAppUserModelId
        title = $p.Title
        artist = $p.Artist
        album = $p.AlbumTitle
        albumArtist = $p.AlbumArtist
        status = "$($info.PlaybackStatus)"
        rate = if ($info.PlaybackRate) { [double]$info.PlaybackRate } else { 1 }
        position = $tl.Position.TotalSeconds
        duration = ($tl.EndTime - $tl.StartTime).TotalSeconds
        updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
        canNext = [bool]$info.Controls.IsNextEnabled
        canPrev = [bool]$info.Controls.IsPreviousEnabled
        track = $track
      }
      $out = $o | ConvertTo-Json -Compress
    }
    if ($out -ne $lastJson) {
      $lastJson = $out
      [Console]::Out.WriteLine($out)
      [Console]::Out.Flush()
    }
  } catch {
    [Console]::Out.WriteLine((@{ error = "$_" } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 1500
  }
  Start-Sleep -Milliseconds 400
}
