import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('audio timeline playhead resolves source trim, boundaries, volume, and clip-relative fades', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioClipPlaybackState } = await vite.ssrLoadModule('/src/video-composition.ts')
    const clip = { startMs: 1200, durationMs: 3000, sourceStartMs: 500, sourceDurationMs: 9000, volume: 0.35 }
    assert.deepEqual(getAudioClipPlaybackState(clip, 1199), { active: false, sourceTimeMs: null, gain: 0 })
    assert.deepEqual(getAudioClipPlaybackState(clip, 1200), { active: true, sourceTimeMs: 500, gain: 0.35 }, 'clip start maps to its trimmed source start')
    assert.deepEqual(getAudioClipPlaybackState(clip, 2700), { active: true, sourceTimeMs: 2000, gain: 0.35 })
    const faded = { ...clip, durationMs: 3000, fadeInMs: 1000, fadeOutMs: 1000 }
    assert.deepEqual(getAudioClipPlaybackState(faded, 1200), { active: true, sourceTimeMs: 500, gain: 0 })
    assert.deepEqual(getAudioClipPlaybackState(faded, 1700), { active: true, sourceTimeMs: 1000, gain: 0.175 })
    assert.deepEqual(getAudioClipPlaybackState(faded, 3700), { active: true, sourceTimeMs: 3000, gain: 0.175 })
    assert.deepEqual(getAudioClipPlaybackState(faded, 4199), { active: true, sourceTimeMs: 3499, gain: 0.00035 })
    assert.deepEqual(getAudioClipPlaybackState(clip, 4200), { active: false, sourceTimeMs: null, gain: 0 }, 'clip end is exclusive')
    assert.deepEqual(getAudioClipPlaybackState({ ...clip, durationMs: 6000 }, 6199), { active: true, sourceTimeMs: 5499, gain: 0.35 }, 'playback never runs beyond the remaining source duration')
    assert.deepEqual(getAudioClipPlaybackState({ ...clip, volume: 4 }, 1200), { active: true, sourceTimeMs: 500, gain: 1 }, 'gain is clamped to the linear [0, 1] range')
    assert.deepEqual(getAudioClipPlaybackState({ ...clip, volume: Number.NaN }, 1200), { active: true, sourceTimeMs: 500, gain: 1 }, 'malformed gain falls back to unity')
    assert.deepEqual(getAudioClipPlaybackState(clip, Number.NaN), { active: false, sourceTimeMs: null, gain: 0 })
  } finally { await vite.close() }
})

test('splitting a selected audio timeline clip preserves source intervals, gain envelope, and rejects unsafe cuts', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioClipPlaybackState, splitVideoTimelineClipAt } = await vite.ssrLoadModule('/src/video-composition.ts')
    const source = { id: 'audio-source', assetId: 'asset-audio', name: 'Source.wav', kind: 'audio', startMs: 2500, durationMs: 10000, sourceStartMs: 1000, sourceDurationMs: 15000, volume: 0.5, fadeInMs: 1000, fadeOutMs: 2000 }
    const split = splitVideoTimelineClipAt(source, 7000, 'audio-second')
    assert.ok(split)
    assert.deepEqual([split.first.id, split.first.startMs, split.first.durationMs, split.first.sourceStartMs, split.first.fadeInMs, split.first.fadeOutMs], ['audio-source', 2500, 4500, 1000, 1000, undefined])
    assert.deepEqual([split.second.id, split.second.startMs, split.second.durationMs, split.second.sourceStartMs, split.second.fadeInMs, split.second.fadeOutMs], ['audio-second', 7000, 5500, 5500, undefined, 2000])
    assert.equal(split.first.id, source.id, 'the left segment retains the original identity')
    assert.equal(split.second.volume, source.volume, 'both segments preserve source gain')
    assert.equal(split.first.sourceStartMs + split.first.durationMs, split.second.sourceStartMs, 'source intervals are contiguous without overlap or gap')
    for (const time of [2500, 3000, 3499, 3500, 6999]) {
      assert.deepEqual(getAudioClipPlaybackState(split.first, time), getAudioClipPlaybackState(source, time), `left interval playback is unchanged at ${time}ms`)
    }
    for (const time of [7000, 7499, 8000, 10000, 12499]) {
      assert.deepEqual(getAudioClipPlaybackState(split.second, time), getAudioClipPlaybackState(source, time), `right interval playback is unchanged at ${time}ms`)
    }
    assert.equal(splitVideoTimelineClipAt(source, source.startMs, 'boundary'), null, 'a split at the clip start is rejected')
    assert.equal(splitVideoTimelineClipAt(source, source.startMs + source.durationMs, 'boundary'), null, 'a split at the clip end is rejected')
    assert.equal(splitVideoTimelineClipAt(source, source.startMs + 500, 'fade-in'), null, 'a split inside the fade-in is rejected because the current envelope model cannot preserve its starting gain')
    assert.equal(splitVideoTimelineClipAt(source, source.startMs + source.durationMs - 500, 'fade-out'), null, 'a split inside the fade-out is rejected because the current envelope model cannot preserve its starting gain')
    assert.equal(splitVideoTimelineClipAt({ ...source, durationMs: 10000, opacityKeyframes: [{ timeMs: 2000, opacity: 50 }] }, 7000, 'animated'), null, 'keyframed clips require animation-envelope rebasing before they can be split')
  } finally { await vite.close() }
})

test('video clip fitting, scale, and framing offsets produce a stable scene-space layout', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getVideoClipLayout } = await vite.ssrLoadModule('/src/video-composition.ts')
    assert.deepEqual(getVideoClipLayout({}, 160, 90, 160, 90), { x: 0, y: 0, width: 160, height: 90 })
    assert.deepEqual(getVideoClipLayout({}, 160, 90, 90, 90), { x: 35, y: 0, width: 90, height: 90 })
    assert.deepEqual(getVideoClipLayout({ fitMode: 'cover' }, 160, 90, 90, 90), { x: 0, y: -35, width: 160, height: 160 })
    assert.deepEqual(getVideoClipLayout({ scale: 150, offsetX: 10, offsetY: -10 }, 160, 90, 160, 90), { x: -24, y: -31.5, width: 240, height: 135 })
    assert.deepEqual(getVideoClipLayout({ scale: 999, offsetX: -999, offsetY: 999 }, 160, 90, 160, 90), { x: -320, y: 0, width: 480, height: 270 }, 'layout calculation clamps values even when called with unvalidated saved data')
    assert.deepEqual(getVideoClipLayout({ scale: Number.NaN, offsetX: Number.POSITIVE_INFINITY }, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, 0), { x: 0, y: 0, width: 1, height: 1 }, 'non-finite saved geometry falls back to a finite one-pixel layout')
  } finally { await vite.close() }
})

test('video opacity keyframes interpolate over clip-relative time and replace points at the same time', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getVideoClipOpacity, removeVideoOpacityKeyframe, setVideoOpacityKeyframe, setVideoOpacityKeyframeEasing } = await vite.ssrLoadModule('/src/video-composition.ts')
    const keyframes = setVideoOpacityKeyframe(setVideoOpacityKeyframe(undefined, 100, 0), 900, 100)
    assert.deepEqual(keyframes, [{ timeMs: 100, opacity: 0 }, { timeMs: 900, opacity: 100 }])
    assert.equal(getVideoClipOpacity({ opacity: 50, opacityKeyframes: keyframes }, 0), 50)
    assert.equal(getVideoClipOpacity({ opacityKeyframes: keyframes }, 500), 50)
    assert.equal(getVideoClipOpacity({ opacityKeyframes: keyframes, animationEasing: 'ease-in' }, 500), 25)
    assert.equal(getVideoClipOpacity({ opacityKeyframes: keyframes, animationEasing: 'ease-out' }, 500), 75)
    assert.equal(getVideoClipOpacity({ opacityKeyframes: keyframes, animationEasing: 'ease-in-out' }, 500), 50)
    const perSegmentEasing = setVideoOpacityKeyframeEasing(keyframes, 100, 'ease-in')
    assert.deepEqual(perSegmentEasing[0], { timeMs: 100, opacity: 0, easing: 'ease-in' })
    assert.equal(getVideoClipOpacity({ opacityKeyframes: perSegmentEasing, animationEasing: 'ease-out' }, 500), 25, 'the left keyframe curve overrides the clip curve for its outgoing segment')
    assert.deepEqual(setVideoOpacityKeyframe(perSegmentEasing, 100, 10)[0], { timeMs: 100, opacity: 10, easing: 'ease-in' }, 'changing the point value preserves its outgoing curve')
    assert.deepEqual(setVideoOpacityKeyframeEasing(perSegmentEasing, 100, null)[0], { timeMs: 100, opacity: 0, easing: undefined }, 'clearing a point curve restores clip-level easing')
    assert.equal(getVideoClipOpacity({ opacityKeyframes: keyframes }, 1200), 100)
    assert.equal(getVideoClipOpacity({ opacityKeyframes: [{ timeMs: 100, opacity: 10 }, { timeMs: 100, opacity: 20 }, { timeMs: 900, opacity: 80 }, { timeMs: Number.NaN, opacity: 99 }] }, 500), 50, 'duplicate times keep the last valid point and malformed points are ignored')
    assert.equal(getVideoClipOpacity({ opacityKeyframes: [{ timeMs: 100, opacity: Number.NaN }], opacity: Number.NaN }, Number.NaN), 100, 'malformed opacity data falls back to a finite default')
    assert.deepEqual(setVideoOpacityKeyframe(keyframes, 500, 25), [{ timeMs: 100, opacity: 0 }, { timeMs: 500, opacity: 25 }, { timeMs: 900, opacity: 100 }])
    assert.deepEqual(removeVideoOpacityKeyframe(keyframes, 100), [{ timeMs: 900, opacity: 100 }])
  } finally { await vite.close() }
})

test('video framing keyframes interpolate scale and offsets and can be replaced or removed', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getVideoClipTransform, removeVideoTransformKeyframe, setVideoTransformKeyframe, setVideoTransformKeyframeEasing } = await vite.ssrLoadModule('/src/video-composition.ts')
    const keyframes = setVideoTransformKeyframe(setVideoTransformKeyframe(undefined, 0, { scale: 100, offsetX: 0, offsetY: 0 }), 1000, { scale: 200, offsetX: 40, offsetY: -20 })
    assert.deepEqual(getVideoClipTransform({ transformKeyframes: keyframes }, 500), { scale: 150, offsetX: 20, offsetY: -10 })
    assert.deepEqual(getVideoClipTransform({ transformKeyframes: keyframes, animationEasing: 'ease-in' }, 500), { scale: 125, offsetX: 10, offsetY: -5 })
    const perSegmentEasing = setVideoTransformKeyframeEasing(keyframes, 0, 'ease-out')
    assert.deepEqual(perSegmentEasing[0], { timeMs: 0, scale: 100, offsetX: 0, offsetY: 0, easing: 'ease-out' })
    assert.deepEqual(getVideoClipTransform({ transformKeyframes: perSegmentEasing, animationEasing: 'ease-in' }, 500), { scale: 175, offsetX: 30, offsetY: -15 }, 'the point curve overrides the clip curve for its outgoing segment')
    assert.deepEqual(setVideoTransformKeyframe(perSegmentEasing, 0, { scale: 120, offsetX: 0, offsetY: 0 })[0], { timeMs: 0, scale: 120, offsetX: 0, offsetY: 0, easing: 'ease-out' }, 'changing framing values preserves the outgoing curve')
    assert.deepEqual(setVideoTransformKeyframeEasing(perSegmentEasing, 0, null)[0], { timeMs: 0, scale: 100, offsetX: 0, offsetY: 0, easing: undefined })
    assert.deepEqual(getVideoClipTransform({ transformKeyframes: keyframes }, 1500), { scale: 200, offsetX: 40, offsetY: -20 })
    assert.deepEqual(getVideoClipTransform({ transformKeyframes: [{ timeMs: 0, scale: 100, offsetX: 0, offsetY: 0 }, { timeMs: 0, scale: 150, offsetX: 10, offsetY: 20 }, { timeMs: 500, scale: Number.NaN, offsetX: 0, offsetY: 0 }] }, 0), { scale: 150, offsetX: 10, offsetY: 20 }, 'duplicate times keep the last valid transform and non-finite transforms are ignored')
    assert.deepEqual(getVideoClipTransform({ scale: Number.POSITIVE_INFINITY, offsetX: Number.NaN }, Number.NaN), { scale: 100, offsetX: 0, offsetY: 0 }, 'malformed base transforms and playhead values fall back safely')
    assert.deepEqual(removeVideoTransformKeyframe(keyframes, 0), [{ timeMs: 1000, scale: 200, offsetX: 40, offsetY: -20 }])
  } finally { await vite.close() }
})
