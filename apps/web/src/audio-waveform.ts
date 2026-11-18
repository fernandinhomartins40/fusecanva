/**
 * Reduce decoded PCM channels to a compact peak envelope for timeline previews.
 * Each output value is the largest absolute sample across all channels in its
 * time bucket, clamped to the normalized audio range [0, 1].
 */
export function getAudioWaveformPeaks(
  channels: readonly ArrayLike<number>[],
  peakCount: number,
): number[] {
  if (!Number.isInteger(peakCount) || peakCount < 1 || peakCount > 16_384) {
    throw new RangeError('peakCount must be an integer between 1 and 16384')
  }

  const sampleCount = channels.reduce((length, channel) => Math.max(length, channel.length), 0)
  if (sampleCount === 0 || channels.length === 0) return Array(peakCount).fill(0)

  return Array.from({ length: peakCount }, (_, peakIndex) => {
    const start = Math.floor(peakIndex * sampleCount / peakCount)
    const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((peakIndex + 1) * sampleCount / peakCount)))
    let peak = 0

    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const sample = channel[sampleIndex]
        if (typeof sample !== 'number' || !Number.isFinite(sample)) continue
        peak = Math.max(peak, Math.min(1, Math.abs(sample)))
      }
    }

    return Math.round(peak * 10_000) / 10_000
  })
}

/** Build a waveform for the source-time interval currently used by a timeline clip. */
export function getAudioWaveformRangePeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  sourceStartMs: number,
  durationMs: number,
  peakCount: number,
): number[] {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(sourceStartMs) || sourceStartMs < 0 || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('Audio range must use a positive sample rate and non-negative finite times')
  }
  const start = Math.floor(sourceStartMs * sampleRate / 1000)
  const end = Math.min(channels.reduce((length, channel) => Math.max(length, channel.length), 0), Math.floor((sourceStartMs + durationMs) * sampleRate / 1000))
  return getAudioWaveformPeaks(channels.map(channel => channel.subarray(start, Math.max(start, end))), peakCount)
}

export interface AudioBeatMarkerOptions {
  /** Minimum number of envelope buckets between returned markers. */
  minDistance?: number
  /** Candidate floor after peak-relative normalization, in [0, 1]. */
  threshold?: number
}

export type AudioBeatTimelineMarker = {
  /** Approximate timestamp in the underlying media source. */
  sourceTimeMs: number
  /** Approximate timestamp on the current project timeline. */
  timelineTimeMs: number
  /** Marker position in the clip's visible waveform, normalized to [0, 1]. */
  clipProgress: number
}

/**
 * Project source-envelope buckets onto a trimmed audio clip and its timeline slot.
 * Audio clips currently play at 1x (the model has no playback-rate field), so
 * source and timeline deltas are equal. Moving/resizing the clip changes only
 * its timeline mapping; source trim changes the source interval being analyzed.
 */
export function mapAudioBeatMarkersToTimeline(
  markerIndices: readonly number[],
  peakCount: number,
  clip: { sourceStartMs: number; startMs: number; durationMs: number; sourceDurationMs: number },
): AudioBeatTimelineMarker[] {
  if (!Number.isInteger(peakCount) || peakCount < 1 || peakCount > 16_384) {
    throw new RangeError('peakCount must be an integer between 1 and 16384')
  }
  if (![clip.sourceStartMs, clip.startMs, clip.durationMs, clip.sourceDurationMs].every(Number.isFinite)
    || clip.sourceStartMs < 0 || clip.startMs < 0 || clip.durationMs <= 0 || clip.sourceDurationMs < clip.sourceStartMs
    || clip.sourceStartMs + clip.durationMs > clip.sourceDurationMs) {
    throw new RangeError('Audio clip source and timeline ranges must be valid')
  }

  return markerIndices.flatMap(index => {
    if (!Number.isInteger(index) || index < 0 || index >= peakCount) return []
    const clipProgress = (index + 0.5) / peakCount
    const offsetMs = clipProgress * clip.durationMs
    return [{
      sourceTimeMs: clip.sourceStartMs + offsetMs,
      timelineTimeMs: clip.startMs + offsetMs,
      clipProgress,
    }]
  })
}

/**
 * Find prominent envelope peaks as approximate rhythm markers.
 *
 * This is a deterministic, peak-relative heuristic, not Canva's algorithm or
 * a tempo/beat tracker: values are normalized by the envelope maximum, local
 * maxima below `threshold` are discarded, then the strongest candidates win
 * within `minDistance` buckets. Returned values are envelope indices.
 */
export function getAudioBeatMarkers(
  peakEnvelope: readonly number[],
  options: AudioBeatMarkerOptions = {},
): number[] {
  const { minDistance = 4, threshold = 0.55 } = options
  if (!Number.isInteger(minDistance) || minDistance < 1 || minDistance > 16_384) {
    throw new RangeError('minDistance must be an integer between 1 and 16384')
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('threshold must be a finite number between 0 and 1')
  }
  if (peakEnvelope.length > 16_384) {
    throw new RangeError('peakEnvelope must contain no more than 16384 values')
  }

  const magnitudes = peakEnvelope.map(value => typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0)
  const maximum = magnitudes.reduce((max, value) => Math.max(max, value), 0)
  if (maximum === 0) return []
  const normalized = magnitudes.map(value => value / maximum)

  const candidates: Array<{ index: number; strength: number }> = []
  for (let index = 0; index < normalized.length;) {
    const strength = normalized[index]
    let plateauEnd = index
    while (plateauEnd + 1 < normalized.length && normalized[plateauEnd + 1] === strength) plateauEnd += 1
    const left = normalized[index - 1] ?? -Infinity
    const right = normalized[plateauEnd + 1] ?? -Infinity
    if (strength > 0 && strength >= threshold && strength > left && strength > right) {
      candidates.push({ index: Math.floor((index + plateauEnd) / 2), strength })
    }
    index = plateauEnd + 1
  }

  // Stable tie-break: stronger first, then earlier index. Greedy suppression
  // makes the result independent of input engine sort stability.
  candidates.sort((a, b) => b.strength - a.strength || a.index - b.index)
  const accepted: number[] = []
  for (const candidate of candidates) {
    if (accepted.every(index => Math.abs(index - candidate.index) >= minDistance)) {
      accepted.push(candidate.index)
    }
  }
  return accepted.sort((a, b) => a - b)
}
