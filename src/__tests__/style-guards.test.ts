import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('style-guards: loader spinner classes', () => {
  const cssPath = path.resolve(import.meta.dir, '../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')
  const paneDrawerPath = path.resolve(import.meta.dir, '../components/pane-drawer.tsx')
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')
  const spaceDrawerPath = path.resolve(import.meta.dir, '../components/space-drawer.tsx')
  const spaceDrawerContent = fs.readFileSync(spaceDrawerPath, 'utf8')

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

  it('keeps lifecycle controls touch-safe and assigns non-overlapping Tab header ownership', () => {
    expect(extractClassBlock('space-drawer-action')).toContain('min-height: 44px')
    expect(extractClassBlock('tab-close-action')).toContain('min-height: 44px')
    expect(cssContent).toContain('.lifecycle-cancel-btn,\n.lifecycle-danger-btn {\n  min-height: 44px')
    expect(extractClassBlock('tab-group__info')).toContain('min-width: 0')
    expect(extractClassBlock('tab-group__info')).toContain('flex: 1 1 auto')
    expect(extractClassBlock('tab-group__actions')).toContain('flex: 0 1 auto')
    expect(cssContent).toContain('@media (max-width: 390px)')
    expect(cssContent).toContain('flex-wrap: wrap')
    expect(spaceDrawerContent).toContain('aria-label="Space lifecycle actions"')
    expect(paneDrawerContent).not.toContain('Space lifecycle actions')
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

describe('style-guards: iPhone keyboard viewport ownership', () => {
  const readSource = (relativePath: string): string => {
    return fs.readFileSync(path.resolve(import.meta.dir, relativePath), 'utf8')
  }

  it('keeps browser resize ownership on the visual viewport instead of the layout viewport', () => {
    const rootContent = readSource('../../app/root.tsx')

    expect(rootContent).toContain('interactive-widget=resizes-visual')
    expect(rootContent).not.toContain('interactive-widget=resizes-content')
  })

  it('wires keyboard state through every visual viewport app shell consumer', () => {
    const keyboardAttribute = "data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}"

    expect(readSource('../app.tsx')).toContain(keyboardAttribute)
    expect(readSource('../../app/routes/_index.tsx')).toContain(keyboardAttribute)
    expect(readSource('../../app/routes/settings.tsx')).toContain(keyboardAttribute)
  })

  it('suppresses only the footer safe-bottom inset while the software keyboard is open', () => {
    const cssContent = readSource('../app.css')

    expect(cssContent).toContain('--footer-safe-bottom: var(--safe-bottom);')
    expect(cssContent).toContain(".herdr-app[data-keyboard-open='true']")
    expect(cssContent).toContain('--footer-safe-bottom: 0px;')
    expect(cssContent).toContain('padding-bottom: max(6px, var(--footer-safe-bottom));')
  })
})
