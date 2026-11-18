export type VideoExportFormat = 'mp4' | 'webm'

export function videoExportMimeCandidates(format: VideoExportFormat, hasAudio: boolean): string[] {
  if (format === 'webm') {
    return hasAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  }
  return hasAudio
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.4D401E,mp4a.40.2', 'video/mp4']
    : ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.4D401E', 'video/mp4']
}

export function resolveVideoExportMimeType(
  format: VideoExportFormat,
  hasAudio: boolean,
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return videoExportMimeCandidates(format, hasAudio).find(mimeType => isTypeSupported(mimeType)) ?? null
}

export function isVideoExportFormatSupported(
  format: VideoExportFormat,
  hasAudio: boolean,
  isTypeSupported: (mimeType: string) => boolean,
): boolean {
  return resolveVideoExportMimeType(format, hasAudio, isTypeSupported) !== null
}
