export type BridgeBackendStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export const bridgeStatusIsHealthy = (status: unknown): status is 'connected' => status === 'connected'
