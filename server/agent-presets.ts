export interface IAgentPreset {
  readonly id: string
  readonly name: string
  readonly kind: 'agy'
  readonly model: string
  readonly effort: 'high' | 'medium' | 'low'
  readonly permissions: 'dangerously-skip-permissions'
  readonly enabled: boolean
  readonly argv: readonly string[]
}

export const DORMANT_AGENT_PRESETS: readonly IAgentPreset[] = [
  {
    id: 'agy-gemini-3.8-flash-high',
    name: 'Agy Gemini 3.8 Flash High',
    kind: 'agy',
    model: 'gemini-3.8-flash-high',
    effort: 'high',
    permissions: 'dangerously-skip-permissions',
    enabled: false,
    argv: [
      'agy',
      '--model',
      'gemini-3.8-flash-high',
      '--dangerously-skip-permissions'
    ]
  }
] as const

export const getAgentPreset = (id: string): IAgentPreset | undefined => {
  return DORMANT_AGENT_PRESETS.find((p) => p.id === id)
}

export const validateAgentPresetExecution = (): { allowed: false; error: string } => {
  return {
    allowed: false,
    error: 'Agent presets are dormant; no agent launch runtime or route is enabled.'
  }
}
