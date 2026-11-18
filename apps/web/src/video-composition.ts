import type { VideoOpacityKeyframe, VideoTimelineClip, VideoTransformKeyframe } from './model'

export type VideoClipLayout = { x: number; y: number; width: number; height: number }
export type VideoAnimationEasing = NonNullable<VideoTimelineClip['animationEasing']>
export type AudioClipPlaybackState = { active: boolean; sourceTimeMs: number | null; gain: number }

export type SplitVideoTimelineClipResult = { first: VideoTimelineClip; second: VideoTimelineClip }

/** Split a selected media clip at an interior playhead without changing its source or gain.
 * Keyframed clips and cuts inside an audio fade are rejected because the current clip model
 * cannot represent those split envelopes without changing the rendered result.
 */
export function splitVideoTimelineClipAt(clip: VideoTimelineClip, playheadMs: number, secondId: string): SplitVideoTimelineClipResult | null {
  if (!Number.isFinite(playheadMs) || !Number.isFinite(clip.startMs) || !Number.isFinite(clip.durationMs)
    || !Number.isFinite(clip.sourceStartMs) || !Number.isFinite(clip.sourceDurationMs)
    || clip.durationMs < 200 || clip.sourceStartMs < 0 || clip.sourceDurationMs <= clip.sourceStartMs
    || clip.sourceStartMs + clip.durationMs > clip.sourceDurationMs
    || (clip.opacityKeyframes?.length ?? 0) > 0 || (clip.transformKeyframes?.length ?? 0) > 0) return null
  const offset = Math.round(playheadMs - clip.startMs)
  const remainder = clip.durationMs - offset
  if (offset < 100 || remainder < 100 || !secondId || secondId === clip.id) return null

  const fadeInMs = clip.kind === 'audio' ? clip.fadeInMs ?? 0 : 0
  const fadeOutMs = clip.kind === 'audio' ? clip.fadeOutMs ?? 0 : 0
  if (!Number.isFinite(fadeInMs) || !Number.isFinite(fadeOutMs)
    || fadeInMs > offset || fadeOutMs > remainder || fadeInMs + fadeOutMs > clip.durationMs) return null

  const { fadeInMs: _fadeIn, fadeOutMs: _fadeOut, ...base } = clip
  const first: VideoTimelineClip = {
    ...base,
    durationMs: offset,
    ...(clip.kind === 'audio' && fadeInMs > 0 ? { fadeInMs } : {}),
  }
  const second: VideoTimelineClip = {
    ...base,
    id: secondId,
    startMs: clip.startMs + offset,
    durationMs: remainder,
    sourceStartMs: clip.sourceStartMs + offset,
    ...(clip.kind === 'audio' && fadeOutMs > 0 ? { fadeOutMs } : {}),
  }
  return { first, second }
}

/** Resolve a timeline playhead to the trimmed source position and linear gain. */
export function getAudioClipPlaybackState(
  clip: Pick<VideoTimelineClip, 'startMs' | 'durationMs' | 'sourceStartMs' | 'sourceDurationMs' | 'volume' | 'fadeInMs' | 'fadeOutMs'>,
  projectTimeMs: number,
): AudioClipPlaybackState {
  const inactive: AudioClipPlaybackState = { active: false, sourceTimeMs: null, gain: 0 }
  if (!Number.isFinite(projectTimeMs)
    || !Number.isFinite(clip.startMs) || clip.startMs < 0
    || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0
    || !Number.isFinite(clip.sourceStartMs) || clip.sourceStartMs < 0
    || !Number.isFinite(clip.sourceDurationMs) || clip.sourceDurationMs <= clip.sourceStartMs) return inactive

  const availableSourceDuration = clip.sourceDurationMs - clip.sourceStartMs
  const playableDuration = Math.min(clip.durationMs, availableSourceDuration)
  const localTimeMs = projectTimeMs - clip.startMs
  if (localTimeMs < 0 || localTimeMs >= playableDuration) return inactive

  const fadeIn = Number.isFinite(clip.fadeInMs) ? Math.max(0, Math.min(playableDuration, clip.fadeInMs!)) : 0
  const fadeOut = Number.isFinite(clip.fadeOutMs) ? Math.max(0, Math.min(playableDuration, clip.fadeOutMs!)) : 0
  const fadeInGain = fadeIn > 0 ? Math.min(1, localTimeMs / fadeIn) : 1
  const fadeOutGain = fadeOut > 0 ? Math.min(1, (playableDuration - localTimeMs) / fadeOut) : 1
  const gain = (Number.isFinite(clip.volume) ? Math.max(0, Math.min(1, clip.volume)) : 1) * fadeInGain * fadeOutGain
  return { active: true, sourceTimeMs: clip.sourceStartMs + localTimeMs, gain }
}

export function easeVideoAnimationProgress(progress: number, easing: VideoAnimationEasing = 'linear'): number {
  const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  if (easing === 'ease-in') return t * t
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t)
  if (easing === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return t
}

function keyframeEasing(easing: VideoAnimationEasing | undefined, fallback: VideoAnimationEasing | undefined): VideoAnimationEasing {
  return easing === 'linear' || easing === 'ease-in' || easing === 'ease-out' || easing === 'ease-in-out'
    ? easing
    : fallback ?? 'linear'
}

function orderedUniqueKeyframes<T extends { timeMs: number }>(keyframes: T[] | undefined, isValid: (keyframe: T) => boolean): T[] {
  const byTime = new Map<number, T>()
  for (const keyframe of keyframes ?? []) {
    if (!keyframe || !Number.isFinite(keyframe.timeMs) || keyframe.timeMs < 0 || !isValid(keyframe)) continue
    byTime.set(keyframe.timeMs, keyframe)
  }
  return [...byTime.values()].sort((left, right) => left.timeMs - right.timeMs)
}

export function getVideoClipLayout(
  clip: Pick<VideoTimelineClip, 'fitMode' | 'scale' | 'offsetX' | 'offsetY'>,
  stageWidth: number,
  stageHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): VideoClipLayout {
  const safeExtent = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1
  const safeStageWidth = safeExtent(stageWidth)
  const safeStageHeight = safeExtent(stageHeight)
  const safeSourceWidth = safeExtent(sourceWidth)
  const safeSourceHeight = safeExtent(sourceHeight)
  const fit = clip.fitMode === 'cover' ? Math.max(safeStageWidth / safeSourceWidth, safeStageHeight / safeSourceHeight) : Math.min(safeStageWidth / safeSourceWidth, safeStageHeight / safeSourceHeight)
  const scale = (Number.isFinite(clip.scale) ? Math.max(50, Math.min(300, clip.scale!)) : 100) / 100
  const width = safeSourceWidth * fit * scale
  const height = safeSourceHeight * fit * scale
  const offsetX = (Number.isFinite(clip.offsetX) ? Math.max(-100, Math.min(100, clip.offsetX!)) : 0) / 100 * safeStageWidth
  const offsetY = (Number.isFinite(clip.offsetY) ? Math.max(-100, Math.min(100, clip.offsetY!)) : 0) / 100 * safeStageHeight
  return { x: (safeStageWidth - width) / 2 + offsetX, y: (safeStageHeight - height) / 2 + offsetY, width, height }
}

export function getVideoClipOpacity(clip: Pick<VideoTimelineClip, 'opacity' | 'opacityKeyframes' | 'animationEasing'>, timeMs: number): number {
  const base = Number.isFinite(clip.opacity) ? Math.max(0, Math.min(100, clip.opacity!)) : 100
  const keyframes = orderedUniqueKeyframes(clip.opacityKeyframes, keyframe => Number.isFinite(keyframe.opacity) && keyframe.opacity >= 0 && keyframe.opacity <= 100)
  if (!keyframes.length) return base
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
  const first = keyframes[0]
  if (time <= first.timeMs) {
    if (first.timeMs === 0) return first.opacity
    return base + (first.opacity - base) * easeVideoAnimationProgress(time / first.timeMs, clip.animationEasing)
  }
  for (let index = 1; index < keyframes.length; index += 1) {
    const left = keyframes[index - 1]
    const right = keyframes[index]
    if (time <= right.timeMs) return left.opacity + (right.opacity - left.opacity) * easeVideoAnimationProgress((time - left.timeMs) / (right.timeMs - left.timeMs), keyframeEasing(left.easing, clip.animationEasing))
  }
  return keyframes[keyframes.length - 1].opacity
}

export function setVideoOpacityKeyframe(keyframes: VideoOpacityKeyframe[] | undefined, timeMs: number, opacity: number): VideoOpacityKeyframe[] {
  const time = Math.max(0, Math.round(timeMs))
  const previous = (keyframes ?? []).find(keyframe => keyframe.timeMs === time)
  const point = { ...previous, timeMs: time, opacity: Math.max(0, Math.min(100, Math.round(opacity))) }
  return [...(keyframes ?? []).filter(keyframe => keyframe.timeMs !== point.timeMs), point].sort((left, right) => left.timeMs - right.timeMs)
}

/** Set the curve from this opacity keyframe to the next. Passing null restores the clip default. */
export function setVideoOpacityKeyframeEasing(keyframes: VideoOpacityKeyframe[] | undefined, timeMs: number, easing: VideoAnimationEasing | null): VideoOpacityKeyframe[] {
  const time = Math.round(timeMs)
  return (keyframes ?? []).map(keyframe => keyframe.timeMs === time
    ? { ...keyframe, ...(easing ? { easing } : { easing: undefined }) }
    : keyframe)
}

export function removeVideoOpacityKeyframe(keyframes: VideoOpacityKeyframe[] | undefined, timeMs: number): VideoOpacityKeyframe[] {
  const time = Math.round(timeMs)
  return (keyframes ?? []).filter(keyframe => keyframe.timeMs !== time)
}

export function getVideoClipTransform(clip: Pick<VideoTimelineClip, 'scale' | 'offsetX' | 'offsetY' | 'transformKeyframes' | 'animationEasing'>, timeMs: number): Pick<VideoTransformKeyframe, 'scale' | 'offsetX' | 'offsetY'> {
  const base = {
    scale: Number.isFinite(clip.scale) ? Math.max(50, Math.min(300, clip.scale!)) : 100,
    offsetX: Number.isFinite(clip.offsetX) ? Math.max(-100, Math.min(100, clip.offsetX!)) : 0,
    offsetY: Number.isFinite(clip.offsetY) ? Math.max(-100, Math.min(100, clip.offsetY!)) : 0,
  }
  const keyframes = orderedUniqueKeyframes(clip.transformKeyframes, keyframe => Number.isFinite(keyframe.scale) && keyframe.scale >= 50 && keyframe.scale <= 300 && Number.isFinite(keyframe.offsetX) && keyframe.offsetX >= -100 && keyframe.offsetX <= 100 && Number.isFinite(keyframe.offsetY) && keyframe.offsetY >= -100 && keyframe.offsetY <= 100)
  if (!keyframes.length) return base
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
  const first = keyframes[0]
  const interpolate = (left: VideoTransformKeyframe, right: VideoTransformKeyframe, at: number) => {
    const ratio = easeVideoAnimationProgress((at - left.timeMs) / Math.max(1, right.timeMs - left.timeMs), keyframeEasing(left.easing, clip.animationEasing))
    return { scale: left.scale + (right.scale - left.scale) * ratio, offsetX: left.offsetX + (right.offsetX - left.offsetX) * ratio, offsetY: left.offsetY + (right.offsetY - left.offsetY) * ratio }
  }
  if (time <= first.timeMs) return first.timeMs === 0 ? { scale: first.scale, offsetX: first.offsetX, offsetY: first.offsetY } : interpolate({ ...base, timeMs: 0 }, first, time)
  for (let index = 1; index < keyframes.length; index += 1) if (time <= keyframes[index].timeMs) return interpolate(keyframes[index - 1], keyframes[index], time)
  const last = keyframes[keyframes.length - 1]
  return { scale: last.scale, offsetX: last.offsetX, offsetY: last.offsetY }
}

export function setVideoTransformKeyframe(keyframes: VideoTransformKeyframe[] | undefined, timeMs: number, transform: Pick<VideoTransformKeyframe, 'scale' | 'offsetX' | 'offsetY'>): VideoTransformKeyframe[] {
  const time = Math.max(0, Math.round(timeMs))
  const previous = (keyframes ?? []).find(keyframe => keyframe.timeMs === time)
  const point = { ...previous, timeMs: time, scale: Math.max(50, Math.min(300, Math.round(transform.scale))), offsetX: Math.max(-100, Math.min(100, Math.round(transform.offsetX))), offsetY: Math.max(-100, Math.min(100, Math.round(transform.offsetY))) }
  return [...(keyframes ?? []).filter(keyframe => keyframe.timeMs !== point.timeMs), point].sort((left, right) => left.timeMs - right.timeMs)
}

/** Set the curve from this framing keyframe to the next. Passing null restores the clip default. */
export function setVideoTransformKeyframeEasing(keyframes: VideoTransformKeyframe[] | undefined, timeMs: number, easing: VideoAnimationEasing | null): VideoTransformKeyframe[] {
  const time = Math.round(timeMs)
  return (keyframes ?? []).map(keyframe => keyframe.timeMs === time
    ? { ...keyframe, ...(easing ? { easing } : { easing: undefined }) }
    : keyframe)
}

export function removeVideoTransformKeyframe(keyframes: VideoTransformKeyframe[] | undefined, timeMs: number): VideoTransformKeyframe[] {
  const time = Math.round(timeMs)
  return (keyframes ?? []).filter(keyframe => keyframe.timeMs !== time)
}
