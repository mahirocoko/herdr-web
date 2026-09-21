export type PushTransitionType = 'needs_input' | 'done'

export interface IPushConfig {
  ownerLogin: string
  publicKey: string
  privateKey: string
  subject: string
}

export interface IPushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface IPushSubscription {
  endpoint: string
  keys: IPushSubscriptionKeys
  expirationTime?: number | null
  createdAt?: number
  updatedAt?: number
}

export interface IPushPayload {
  type: PushTransitionType | 'test'
  title: string
  body: string
  url: string
  timestamp?: number
  workspaceId?: string
  workspaceLabel?: string
}

export interface IPushConfigResponse {
  ok: boolean
  enabled: boolean
  publicKey?: string
  reason?: string
}

export interface IPushTransition {
  type: PushTransitionType
  workspaceId?: string
  workspaceLabel?: string
  sourceTabId?: string
}

export interface IPushSendResult {
  ok: boolean
  statusCode?: number
  error?: string
  shouldRemove?: boolean
}

export interface ITabTopologyFingerprint {
  workspaceNumber: number
  workspaceLabel: string
  tabNumber: number
  tabLabel: string
}

export interface ITabPolicyOverrideRecord {
  workspaceId: string
  tabId: string
  enabled: boolean
  fingerprint: ITabTopologyFingerprint
  updatedAt?: number
}

export interface ITabPolicyStoreFile {
  version: 1
  overrides: ITabPolicyOverrideRecord[]
}

export interface ILiveTabPolicy {
  workspaceId: string
  tabId: string
  workspaceLabel: string
  workspaceNumber: number
  tabLabel: string
  tabNumber: number
  enabled: boolean
  isDefaultOwner: boolean
  source: 'default' | 'override'
}

export interface ITabPolicyMutationRequest {
  tabId: string
  enabled: boolean
}

export interface ITabPolicyResponse {
  ok: boolean
  tabs: ILiveTabPolicy[]
  error?: string
}
