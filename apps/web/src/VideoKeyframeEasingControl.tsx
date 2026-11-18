import type { VideoAnimationEasing } from './video-composition'

const easingOptions: Array<{ value: VideoAnimationEasing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Entrada suave' },
  { value: 'ease-out', label: 'Saída suave' },
  { value: 'ease-in-out', label: 'Entrada e saída suaves' },
]

type Props = {
  clipName: string
  motion: 'opacidade' | 'enquadramento'
  keyframeTimeMs: number | null
  easing: VideoAnimationEasing | undefined
  clipEasing: VideoAnimationEasing | undefined
  hasFollowingKeyframe: boolean
  disabled?: boolean
  onChange: (easing: VideoAnimationEasing | null) => void
}

/** Accessible segment curve editor. The `clip` choice follows future clip-level changes. */
export function VideoKeyframeEasingControl({ clipName, motion, keyframeTimeMs, easing, clipEasing, hasFollowingKeyframe, disabled = false, onChange }: Props) {
  const available = keyframeTimeMs !== null && hasFollowingKeyframe
  const selected = easing ?? '__clip__'
  const label = `Curva de ${motion} entre quadros de ${clipName}`

  return <label className="video-keyframe-easing">
    Curva deste segmento
    <select
      aria-label={label}
      value={selected}
      disabled={disabled || !available}
      title={!available ? 'Adicione um quadro-chave posterior para editar a curva deste segmento.' : undefined}
      onChange={event => onChange(event.target.value === '__clip__' ? null : event.target.value as VideoAnimationEasing)}
    >
      <option value="__clip__">Usar padrão do clipe ({easingOptions.find(option => option.value === (clipEasing ?? 'linear'))?.label ?? 'Linear'})</option>
      {easingOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}
