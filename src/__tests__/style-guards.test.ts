import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('style-guards: loader spinner classes', () => {
  const cssPath = path.resolve(import.meta.dir, '../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')
  const paneDrawerPath = path.resolve(import.meta.dir, '../components/pane-drawer.tsx')
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')

  const extractClassBlock = (className: string): string => {
    const escaped = className.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
    const regex = new RegExp(`(?:^|\\n)\\.${escaped}\\s*\\{([^}]+)\\}`, 'm')
    const match = cssContent.match(regex)
    if (!match) {
      throw new Error(`CSS class .${className} not found in src/app.css`)
    }
    return match[1]
  }

  it('proves .prompt-composer__spinner has no legacy border-spinner recipe', () => {
    const block = extractClassBlock('prompt-composer__spinner')
    expect(block).not.toContain('border:')
    expect(block).not.toContain('border-top')
    expect(block).not.toContain('border-radius')
    expect(block).not.toContain('animation:')
    expect(block).toContain('display: inline-flex')
  })

  it('proves .surface-header__spinner has no legacy border-spinner recipe', () => {
    const block = extractClassBlock('surface-header__spinner')
    expect(block).not.toContain('border:')
    expect(block).not.toContain('border-top')
    expect(block).not.toContain('border-radius')
    expect(block).not.toContain('animation:')
    expect(block).toContain('display: inline-flex')
  })

  it('proves .pane-explain__spinner has no legacy border-spinner recipe', () => {
    const block = extractClassBlock('pane-explain__spinner')
    expect(block).not.toContain('border:')
    expect(block).not.toContain('border-top')
    expect(block).not.toContain('border-radius')
    expect(block).not.toContain('animation:')
    expect(block).toContain('display: inline-flex')
  })

  it('proves prefers-reduced-motion includes .spin to stop rotation when reduced motion is requested', () => {
    const startIndex = cssContent.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(startIndex).toBeGreaterThan(-1)
    let braceCount = 0
    let endIndex = -1
    for (let i = startIndex; i < cssContent.length; i++) {
      if (cssContent[i] === '{') braceCount++
      else if (cssContent[i] === '}') {
        braceCount--
        if (braceCount === 0) {
          endIndex = i
          break
        }
      }
    }
    const reducedMotionBlock = cssContent.slice(startIndex, endIndex + 1)
    expect(reducedMotionBlock).toContain('.spin')
    expect(reducedMotionBlock).toContain('animation: none !important')
  })

  it('renders per-Tab notifications as a semantic track-and-thumb Switch', () => {
    expect(paneDrawerContent).toContain('role="switch"')
    expect(paneDrawerContent).toContain('aria-checked={isReady ? isNotifyEnabled : false}')
    expect(paneDrawerContent).toContain('aria-disabled={!isReady || isPending}')
    expect(paneDrawerContent).toContain('disabled={!isReady}')
    expect(/\n\s+disabled=\{!isReady \|\| isPending\}/.test(paneDrawerContent)).toBe(false)
    expect(paneDrawerContent).toContain('tab-notify-switch__track')
    expect(paneDrawerContent).toContain('tab-notify-switch__thumb')
    expect(paneDrawerContent).not.toContain('tab-notify-toggle')

    const controlBlock = extractClassBlock('tab-notify-switch')
    const trackBlock = extractClassBlock('tab-notify-switch__track')
    const thumbBlock = extractClassBlock('tab-notify-switch__thumb')
    expect(controlBlock).toContain('min-height: 44px')
    expect(trackBlock).toContain('border-radius: 999px')
    expect(thumbBlock).toContain('transform: translateX(0)')
    expect(cssContent).toContain('.tab-notify-switch--on .tab-notify-switch__thumb')
    expect(cssContent).toContain('transform: translateX(14px)')
  })
})
