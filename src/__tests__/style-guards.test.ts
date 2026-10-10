import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('mobile terminal typography ownership', () => {
  it('keeps landscape drawer reconciliation and iOS input sizing aligned with compact CSS', () => {
    const css = fs.readFileSync(path.resolve('src/app.css'), 'utf8')
    const app = fs.readFileSync(path.resolve('src/app.tsx'), 'utf8')
    expect(app).toContain('mql.matches && !compactLandscape.matches')
    expect(app).toContain(
      "compactLandscape.addEventListener?.('change', handleMediaChange)"
    )
    expect(app).toContain(
      "compactLandscape.removeEventListener?.('change', handleMediaChange)"
    )
    expect(css).toMatch(/max-height: 80px;\s*font-size: 16px;/)
  })

  it('uses one responsive terminal token before measuring real PTY cells', () => {
    const css = fs.readFileSync(path.resolve('src/app.css'), 'utf8')
    const canvas = fs.readFileSync(
      path.resolve('src/components/terminal-canvas.tsx'),
      'utf8'
    )
    expect(css).toContain('--terminal-font-size: var(--fs-md);')
    expect(css).toContain('--terminal-font-size: var(--fs-sm);')
    expect(canvas).toContain("getPropertyValue('--terminal-font-size')")
    expect(canvas).toContain("token('--terminal-font-size')")
    expect(canvas).toContain("modeRef.current === 'observer' &&")
    expect(canvas).toMatch(
      /window\.matchMedia\(\s*['"]\(max-width: 600px\), \(max-width: 1023px\) and \(max-height: 500px\) and \(orientation: landscape\)['"]\s*\)\.matches/
    )
    expect(
      canvas.indexOf('terminalRef.current.options.scrollback = localScrollback')
    ).toBeLessThan(canvas.indexOf('fitAddonRef.current.fit()'))
    expect(
      canvas.indexOf('terminalRef.current.options.fontSize = fontSize')
    ).toBeLessThan(canvas.indexOf('fitAddonRef.current.fit()'))
    expect(css).toContain('.terminal-canvas--fitted .xterm .xterm-viewport')
    expect(css).toMatch(/\.terminal-canvas--fitted \.xterm \{\s*padding: 0;/)
  })
})

describe('forwarded mobile header, key rail and Working spinner scope', () => {
  const css = fs.readFileSync(
    path.resolve(import.meta.dir, '../app.css'),
    'utf8'
  )
  const header = fs.readFileSync(
    path.resolve(import.meta.dir, '../components/horizon-header.tsx'),
    'utf8'
  )

  it('hides the complete breadcrumb on mobile without deleting the desktop Tab handler', () => {
    expect(header).toContain('className="context-sub header-desktop-only"')
    expect(header).toContain('className="context-title-text"')
    expect(header).toContain('activeWorkspace?.label')
    expect(header).not.toContain('Mahiro Code')
    expect(header).toContain('onClick={onOpenTabs}')
    expect(css).toContain('.header-mobile-only')
    expect(css).toContain('@media (max-width: 768px)')
    expect(css).toContain('.horizon-header .context')
    expect(css).toContain('min-width: max-content')
    expect(css).toContain('.horizon-header .view-switch > button')
  })

  it('shares rail height and minimum height across key and settings primitive sizes', () => {
    const rule = css.match(/\.ui-button\.thumb-key-btn\s*\{([^}]+)\}/)?.[1]
    expect(rule).toContain('height: var(--key-control-height)')
    expect(rule).toContain('min-height: var(--key-control-height)')
    expect(rule).not.toContain('background:')
    expect(rule).not.toContain('border:')
    expect(rule).not.toContain('color:')
    const manageRule = css.match(/\.thumb-key-btn--manage\s*\{([^}]+)\}/)?.[1]
    expect(manageRule).not.toMatch(/(?:^|;)\s*(?:min-)?height:/)
  })

  it('renders Working as an open rotating ring, not an opacity pulse', () => {
    const rule = css.match(/\.space-status-dot--working\s*\{([^}]+)\}/)?.[1]
    expect(rule).toContain('border-right-color: transparent')
    expect(rule).toContain('background: transparent')
    expect(css).toContain('animation: spin 1s linear infinite')
    expect(css).not.toContain('@keyframes pulse')
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)')
  })

  it('keeps Space selection without restoring removed nested tabs/panes styles', () => {
    expect(css).not.toContain('.sidebar-workspace-tabs')
    expect(css).not.toContain('.sidebar-pane-item')
    const rowRail = css.match(
      /\.sidebar-workspace-row \.space-drawer-item--selected::before\s*\{([^}]+)\}/
    )?.[1]
    expect(rowRail).toContain('content: none')
    expect(css).not.toContain('.sidebar-workspace-item.is-selected::before')
    expect(css).not.toContain('.horizon-header__workspace-label')
  })

  it('starts the mobile composer as one row without changing desktop markup or IME handlers', () => {
    expect(css.replace(/\s/g, '')).toContain(
      'grid-template-columns:var(--touch-target)minmax(0,1fr)var(--touch-target)'
    )
    expect(css).toContain(
      'min-height: calc(var(--touch-target) + var(--space-1))'
    )
    const composer = fs.readFileSync(
      path.resolve(import.meta.dir, '../components/prompt-composer.tsx'),
      'utf8'
    )
    expect(composer).toContain('window.getComputedStyle(el).minHeight')
    expect(composer).toContain('const minHeight = Math.max(')
    expect(composer).toContain('COMPOSER_MIN_HEIGHT,')
    expect(composer).toContain(
      "window.addEventListener('resize', resizeTextarea)"
    )
    expect(composer).toContain('onCompositionStart=')
    expect(composer).toContain('onCompositionEnd=')
  })

  it('applies compact 1-row composer form and bounds height in low-height mobile landscape', () => {
    expect(css).toContain(
      '(max-width: 1023px) and (max-height: 500px) and (orientation: landscape)'
    )
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)\s*and\s*\(max-height:\s*500px\)\s*and\s*\(orientation:\s*landscape\)\s*\{[\s\S]*?\.prompt-composer__form \.ui-textarea\s*\{\s*max-height:\s*80px;/
    )
    const composer = fs.readFileSync(
      path.resolve(import.meta.dir, '../components/prompt-composer.tsx'),
      'utf8'
    )
    expect(composer).toContain('window.getComputedStyle(el).maxHeight')
    expect(composer).toContain('Math.min(parsedMaxHeight, COMPOSER_MAX_HEIGHT)')
  })
})

describe('style-guards: portaled modal layer ownership', () => {
  it('keeps backdrop below both sheets and floating selects without feature overrides', () => {
    const recipes = fs.readFileSync(
      path.resolve(import.meta.dir, '../components/ui/recipes.css'),
      'utf8'
    )
    const appStyles = fs.readFileSync(
      path.resolve(import.meta.dir, '../app.css'),
      'utf8'
    )
    const layer = (name: string) => {
      const value = recipes.match(new RegExp(`--ui-layer-${name}:\\s*(\\d+)`))
      expect(value).not.toBeNull()
      return Number(value?.[1])
    }
    expect(layer('sheet')).toBeGreaterThan(layer('backdrop'))
    expect(layer('popover')).toBeGreaterThan(layer('sheet'))
    for (const selector of ['drawer-overlay', 'side-drawer-overlay']) {
      const block = appStyles.match(
        new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`)
      )
      expect(block).not.toBeNull()
      expect(block?.[1]).not.toMatch(/z-index\s*:|background(?:-color)?\s*:/)
    }
    expect(recipes).toContain('z-index: var(--ui-layer-backdrop)')
    expect(recipes.match(/z-index: var\(--ui-layer-sheet\)/g)).toHaveLength(3)
    expect(recipes).toContain('z-index: var(--ui-layer-popover)')
  })
})

describe('style-guards: loader spinner classes', () => {
  const cssPath = path.resolve(import.meta.dir, '../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')
  const paneDrawerPath = path.resolve(
    import.meta.dir,
    '../components/pane-drawer.tsx'
  )
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')
  const spaceDrawerPath = path.resolve(
    import.meta.dir,
    '../components/space-drawer.tsx'
  )
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
    const startIndex = cssContent.indexOf(
      '@media (prefers-reduced-motion: reduce)'
    )
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
    expect(extractClassBlock('space-drawer-action')).toContain(
      'min-height: 44px'
    )
    expect(extractClassBlock('tab-close-action')).toContain('min-height: 44px')
    expect(cssContent).toContain(
      '.lifecycle-cancel-btn,\n.lifecycle-danger-btn {\n  min-height: 44px'
    )
    expect(extractClassBlock('tab-group__info')).toContain('min-width: 0')
    expect(extractClassBlock('tab-group__info')).toContain('flex: 1 1 auto')
    expect(extractClassBlock('tab-group__actions')).toContain('flex: 0 1 auto')
    expect(cssContent).toContain('@media (max-width: 390px)')
    expect(cssContent).toContain('flex-wrap: wrap')
    expect(spaceDrawerContent).toContain('aria-label="Space lifecycle actions"')
    expect(paneDrawerContent).not.toContain('Space lifecycle actions')
  })

  it('renders per-Tab notifications as a genuine Base UI Switch', () => {
    expect(paneDrawerContent).toContain('<Switch')
    expect(paneDrawerContent).toContain(
      'checked={isReady ? isNotifyEnabled : false}'
    )
    expect(paneDrawerContent).toContain('disabled={!isReady}')
    expect(
      /\n\s+disabled=\{!isReady \|\| isPending\}/.test(paneDrawerContent)
    ).toBe(false)
    expect(paneDrawerContent).toContain('tab-notify-switch')
    expect(paneDrawerContent).not.toContain('role="switch"')
    expect(paneDrawerContent).not.toContain('tab-notify-toggle')

    // Verify .tab-notify-switch does NOT override root track/thumb geometry
    const controlBlock = extractClassBlock('tab-notify-switch')
    expect(controlBlock).not.toContain('min-width: 44px')
    expect(controlBlock).not.toContain('width:')
    expect(controlBlock).not.toContain('height:')
    expect(controlBlock).not.toContain('border-radius:')
    expect(cssContent).not.toContain('.tab-notify-switch__track')
    expect(cssContent).not.toContain('.tab-notify-switch__thumb')

    // Verify .ui-switch in recipes.css owns the 40x22 pill track and 16px thumb
    const recipes = fs.readFileSync(
      path.resolve(import.meta.dir, '../components/ui/recipes.css'),
      'utf8'
    )
    expect(recipes).toContain('width: 40px')
    expect(recipes).toContain('height: 22px')
    expect(recipes).toContain('.ui-switch__thumb')
    expect(recipes).toContain('width: 16px')
    expect(recipes).toContain('height: 16px')
    expect(recipes).toContain('transform: translateX(18px)')

    // Verify tab-group__actions enforces flex-wrap: nowrap to prevent header blowup
    const actionsBlock = extractClassBlock('tab-group__actions')
    expect(actionsBlock).toContain('flex-wrap: nowrap')
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
    const keyboardAttribute =
      "data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}"

    expect(readSource('../app.tsx')).toContain(keyboardAttribute)
    expect(readSource('../../app/routes/_index.tsx')).toContain(
      keyboardAttribute
    )
    expect(readSource('../../app/routes/settings.tsx')).toContain(
      keyboardAttribute
    )
  })

  it('suppresses only the footer safe-bottom inset while the software keyboard is open', () => {
    const cssContent = readSource('../app.css')

    expect(cssContent).toContain('--footer-safe-bottom: var(--safe-bottom);')
    expect(cssContent).toContain(".herdr-app[data-keyboard-open='true']")
    expect(cssContent).toContain('--footer-safe-bottom: 0px;')
    expect(cssContent).toContain(
      'padding-bottom: max(6px, var(--footer-safe-bottom));'
    )
  })
})

describe('style-guards: Base UI canonical controls and zero role impersonation', () => {
  const readSource = (relativePath: string): string => {
    return fs.readFileSync(path.resolve(import.meta.dir, relativePath), 'utf8')
  }

  it('rejects semantic role impersonation (role="tab", role="tablist", role="switch") in production code', () => {
    const srcDir = path.resolve(import.meta.dir, '..')
    const files = fs.readdirSync(srcDir, { recursive: true }) as string[]
    const prodFiles = files.filter(
      (f) =>
        f.endsWith('.tsx') &&
        !f.includes('components/ui/') &&
        !f.includes('__tests__')
    )

    for (const f of prodFiles) {
      const fullPath = path.join(srcDir, f)
      const content = fs.readFileSync(fullPath, 'utf8')
      expect(content).not.toContain('role="tab"')
      expect(content).not.toContain('role="tablist"')
      expect(content).not.toContain('role="switch"')
    }
  })

  it('proves surface-header.tsx uses ToggleGroup and Toggle without fake tab roles', () => {
    const surfaceHeader = readSource('../components/surface-header.tsx')
    expect(surfaceHeader).toContain('<ToggleGroup')
    expect(surfaceHeader).toContain('<Toggle')
    expect(surfaceHeader).not.toContain('role="tab"')
    expect(surfaceHeader).not.toContain('role="tablist"')
  })

  it('proves interaction-picker-sheet.tsx uses genuine Base UI Tabs and ToggleGroup without role impersonation', () => {
    const picker = readSource('../components/interaction-picker-sheet.tsx')
    expect(picker).toContain('<Tabs')
    expect(picker).toContain('<TabsList')
    expect(picker).toContain('<TabsTab')
    expect(picker).toContain('<TabsPanel')
    expect(picker).toContain('<ToggleGroup')
    expect(picker).toContain('<Toggle')
    expect(picker).not.toContain('role="tab"')
    expect(picker).not.toContain('role="tablist"')
  })

  it('verifies .surface-header__tab and .interaction-picker__tab do not duplicate button/border/focus recipes in app.css', () => {
    const cssContent = readSource('../app.css')
    const surfaceTabMatch = cssContent.match(
      /\.surface-header__tab\s*\{([^}]+)\}/
    )
    expect(surfaceTabMatch).toBeTruthy()
    const surfaceTabBody = surfaceTabMatch![1]
    expect(surfaceTabBody).not.toContain('border:')
    expect(surfaceTabBody).not.toContain('background:')
    expect(surfaceTabBody).not.toContain('cursor:')

    const pickerTabMatch = cssContent.match(
      /\.interaction-picker__tab\s*\{([^}]+)\}/
    )
    expect(pickerTabMatch).toBeTruthy()
    const pickerTabBody = pickerTabMatch![1]
    expect(pickerTabBody).not.toContain('background:')
    expect(pickerTabBody).not.toContain('border-radius:')
    expect(pickerTabBody).not.toContain('cursor:')
  })
})

describe('style-guards: zero duplicate control-paint on feature classes across production src', () => {
  const cssPath = path.resolve(import.meta.dir, '../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')

  const extractBlock = (selector: string): string => {
    const escaped = selector.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
    const regex = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, 'm')
    const match = cssContent.match(regex)
    if (!match) {
      throw new Error(`CSS selector ${selector} not found in src/app.css`)
    }
    return match[1]
  }

  it('rejects duplicate paint, focus, and state overrides on prompt composer controls', () => {
    const composerInputs = extractBlock(
      '.ui-textarea.prompt-composer__textarea'
    )
    expect(composerInputs).not.toContain('background:')
    expect(composerInputs).not.toContain('border:')
    expect(composerInputs).not.toContain('border-radius:')
    expect(composerInputs).not.toContain('color:')
    expect(composerInputs).toContain('resize: none;')
    expect(composerInputs).toContain('min-height: 40px;')
    expect(cssContent).not.toContain('.prompt-composer__textarea:focus-visible')
    expect(cssContent).not.toContain('.prompt-composer__input:focus-visible')
    expect(cssContent).not.toContain('.prompt-composer__textarea:disabled')

    const submitBtn = extractBlock('.prompt-composer__submit-btn')
    expect(submitBtn).not.toContain('background:')
    expect(submitBtn).not.toContain('border:')
    expect(submitBtn).not.toContain('border-radius:')
    expect(submitBtn).not.toContain('color:')
    expect(submitBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.prompt-composer__submit-btn:disabled')
    expect(cssContent).not.toContain('.prompt-composer__submit-btn:active')

    const quickBtn = extractBlock('.prompt-composer__quick-btn')
    expect(quickBtn).not.toContain('background:')
    expect(quickBtn).not.toContain('border:')
    expect(quickBtn).not.toContain('border-radius:')
    expect(quickBtn).not.toContain('color:')
    expect(quickBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.prompt-composer__quick-btn:hover')
    expect(cssContent).not.toContain('.prompt-composer__quick-btn:active')
    expect(cssContent).not.toContain('.prompt-composer__quick-btn:disabled')
  })

  it('rejects undeclared border and shadow tokens in prompt composer card', () => {
    const formBlock = extractBlock('.prompt-composer__form')
    expect(formBlock).not.toContain('var(--color-border)')
    expect(formBlock).not.toContain('var(--shadow-sm)')
    expect(formBlock).toContain('var(--color-control-border)')
    expect(formBlock).toContain('var(--shadow-control)')
    expect(cssContent).toMatch(/--color-control-border:\s*#[0-9a-f]{6};/)
    expect(cssContent).toMatch(/--shadow-control:\s*inset/)
  })

  it('rejects duplicate paint on drawer controls, selects, and lifecycle actions', () => {
    const closeBtn = extractBlock('.drawer-sheet__close-btn')
    expect(closeBtn).not.toContain('background:')
    expect(closeBtn).not.toContain('border:')
    expect(closeBtn).not.toContain('color:')
    expect(closeBtn).not.toContain('cursor:')

    const backBtn = extractBlock('.drawer-sheet__back-btn')
    expect(backBtn).not.toContain('background:')
    expect(backBtn).not.toContain('border:')
    expect(backBtn).not.toContain('color:')
    expect(backBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.drawer-sheet__back-btn:active')

    const newTabInput = extractBlock('.new-tab-field__input')
    expect(newTabInput).not.toContain('background:')
    expect(newTabInput).not.toContain('border:')
    expect(newTabInput).not.toContain('color:')
    expect(cssContent).not.toContain('.new-tab-field__input:focus-visible')

    const newTabSubmit = extractBlock('.new-tab-submit-btn')
    expect(newTabSubmit).not.toContain('background:')
    expect(newTabSubmit).not.toContain('border:')
    expect(newTabSubmit).not.toContain('color:')
    expect(newTabSubmit).not.toContain('cursor:')
    expect(cssContent).not.toContain('.new-tab-submit-btn:disabled')

    const lifecycleBtns = extractBlock(
      '.lifecycle-cancel-btn,\n.lifecycle-danger-btn'
    )
    expect(lifecycleBtns).not.toContain('background:')
    expect(lifecycleBtns).not.toContain('border:')
    expect(lifecycleBtns).not.toContain('color:')
    expect(lifecycleBtns).not.toContain('cursor:')
    expect(cssContent).not.toContain('.lifecycle-cancel-btn:disabled')
    expect(cssContent).not.toContain('.lifecycle-danger-btn:disabled')

    const paneSelect = extractBlock('.pane-card__select')
    expect(paneSelect).not.toContain('background:')
    expect(paneSelect).not.toContain('border:')
    expect(paneSelect).not.toContain('color:')
    expect(paneSelect).not.toContain('cursor:')
    expect(cssContent).not.toContain('.pane-card__select:focus-visible')

    const spaceDrawerAction = extractBlock('.space-drawer-action')
    expect(spaceDrawerAction).not.toContain('background:')
    expect(spaceDrawerAction).not.toContain('border:')
    expect(spaceDrawerAction).not.toContain('color:')
    expect(spaceDrawerAction).not.toContain('cursor:')
    expect(cssContent).not.toContain('.space-drawer-action--danger')
    expect(cssContent).not.toContain('.space-drawer-action:disabled')

    const tabCloseAction = extractBlock('.tab-close-action')
    expect(tabCloseAction).not.toContain('background:')
    expect(tabCloseAction).not.toContain('border:')
    expect(tabCloseAction).not.toContain('cursor:')
    expect(cssContent).not.toContain('.tab-close-action:disabled')
  })

  it('rejects duplicate paint on terminal scope, headers, and refresh buttons', () => {
    const scopeBtn = extractBlock('.terminal-scope-btn')
    expect(scopeBtn).not.toContain('background:')
    expect(scopeBtn).not.toContain('border:')
    expect(scopeBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.terminal-scope-btn--control')
    expect(cssContent).not.toContain('.terminal-scope-btn--release')

    const menuTrigger = extractBlock('.horizon-header__menu-trigger')
    expect(menuTrigger).not.toContain('background')
    expect(menuTrigger).not.toContain('border:')
    expect(menuTrigger).not.toContain('color:')
    expect(menuTrigger).not.toContain('cursor:')
    expect(cssContent).not.toContain('.horizon-header__menu-trigger:hover')
    expect(cssContent).not.toContain('.horizon-header__menu-trigger:active')

    const tabTrigger = extractBlock('.horizon-header__tab-trigger')
    expect(tabTrigger).not.toContain('background')
    expect(tabTrigger).not.toContain('border:')
    expect(tabTrigger).not.toContain('cursor:')
    expect(cssContent).not.toContain('.horizon-header__tab-trigger:hover')
    expect(cssContent).not.toContain('.horizon-header__tab-trigger:active')

    const refreshBtn = extractBlock('.surface-header__refresh-btn')
    expect(refreshBtn).not.toContain('background')
    expect(refreshBtn).not.toContain('border:')
    expect(refreshBtn).not.toContain('color:')
    expect(refreshBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.surface-header__refresh-btn:hover')
    expect(cssContent).not.toContain('.surface-header__refresh-btn:active')
    expect(cssContent).not.toContain('.surface-header__refresh-btn:disabled')
    expect(cssContent).not.toContain(
      '.surface-header__refresh-btn:focus-visible'
    )
  })

  it('rejects duplicate paint on settings and text-surface buttons', () => {
    const settingsBack = extractBlock('.settings-header__back-btn')
    expect(settingsBack).not.toContain('background')
    expect(settingsBack).not.toContain('border:')
    expect(settingsBack).not.toContain('color:')
    expect(settingsBack).not.toContain('cursor:')
    expect(cssContent).not.toContain('.settings-header__back-btn:hover')
    expect(cssContent).not.toContain('.settings-header__back-btn:active')

    const settingsAction = extractBlock('.settings-action-btn')
    expect(settingsAction).not.toContain('background')
    expect(settingsAction).not.toContain('border:')
    expect(settingsAction).not.toContain('color:')
    expect(settingsAction).not.toContain('cursor:')
    expect(cssContent).not.toContain('.settings-action-btn:disabled')
    expect(cssContent).not.toContain('.settings-action-btn--elevated')
    expect(cssContent).not.toContain('.settings-action-btn--ghost-danger')

    const latestBtn = extractBlock('.text-surface-view__latest-btn')
    expect(latestBtn).not.toContain('background:')
    expect(latestBtn).not.toContain('color:')
    expect(latestBtn).not.toContain('border:')
    expect(latestBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain(
      '.text-surface-view__latest-btn:focus-visible'
    )

    const retryBtn = extractBlock(
      '.text-surface-view__retry-btn,\n.text-surface-view__toggle-stream-btn'
    )
    expect(retryBtn).not.toContain('background:')
    expect(retryBtn).not.toContain('border:')
    expect(retryBtn).not.toContain('color:')
    expect(retryBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.text-surface-view__retry-btn:active')

    const questionRetry = extractBlock('.question-view__retry-btn')
    expect(questionRetry).not.toContain('background:')
    expect(questionRetry).not.toContain('border:')
    expect(questionRetry).not.toContain('color:')
    expect(questionRetry).not.toContain('cursor:')
    expect(cssContent).not.toContain('.question-view__retry-btn:active')
  })

  it('rejects duplicate paint on interaction picker controls and confirm buttons', () => {
    const searchInput = extractBlock('.interaction-picker__search-input')
    expect(searchInput).not.toContain('background:')
    expect(searchInput).not.toContain('border:')
    expect(searchInput).not.toContain('color:')
    expect(cssContent).not.toContain(
      '.interaction-picker__search-input:focus-visible'
    )

    const itemBtn = extractBlock('.ui-button.interaction-picker__item-btn')
    expect(itemBtn).not.toContain('background:')
    expect(itemBtn).not.toContain('border:')
    expect(itemBtn).not.toContain('color:')
    expect(itemBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__item-btn:active')

    const editBtn = extractBlock('.interaction-picker__edit-btn')
    expect(editBtn).not.toContain('background:')
    expect(editBtn).not.toContain('border:')
    expect(editBtn).not.toContain('color:')
    expect(editBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__edit-btn:hover')

    const pickerInputs = extractBlock(
      '.interaction-picker__input,\n.interaction-picker__textarea'
    )
    expect(pickerInputs).not.toContain('background:')
    expect(pickerInputs).not.toContain('border:')
    expect(pickerInputs).not.toContain('color:')
    expect(cssContent).not.toContain('.interaction-picker__input:focus-visible')

    const submitBtn = extractBlock('.interaction-picker__submit-btn')
    expect(submitBtn).not.toContain('background:')
    expect(submitBtn).not.toContain('border:')
    expect(submitBtn).not.toContain('color:')
    expect(submitBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__submit-btn:hover')

    const cancelBtn = extractBlock('.interaction-picker__cancel-btn')
    expect(cancelBtn).not.toContain('background:')
    expect(cancelBtn).not.toContain('border:')
    expect(cancelBtn).not.toContain('color:')
    expect(cancelBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__cancel-btn:hover')

    const deleteBtn = extractBlock('.interaction-picker__delete-btn')
    expect(deleteBtn).not.toContain('background:')
    expect(deleteBtn).not.toContain('border:')
    expect(deleteBtn).not.toContain('color:')
    expect(deleteBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__delete-btn:hover')

    const presetBtn = extractBlock('.interaction-picker__preset-btn')
    expect(presetBtn).not.toContain('background:')
    expect(presetBtn).not.toContain('border:')
    expect(presetBtn).not.toContain('color:')
    expect(presetBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__preset-btn:hover')

    const resetBtn = extractBlock('.interaction-picker__reset-btn')
    expect(resetBtn).not.toContain('background:')
    expect(resetBtn).not.toContain('border:')
    expect(resetBtn).not.toContain('color:')
    expect(resetBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.interaction-picker__reset-btn:hover')

    const confirmBtn = extractBlock('.picker-confirm-btn')
    expect(confirmBtn).not.toContain('background:')
    expect(confirmBtn).not.toContain('border:')
    expect(confirmBtn).not.toContain('cursor:')
    expect(cssContent).not.toContain('.picker-confirm-btn--replace')
    expect(cssContent).not.toContain('.picker-confirm-btn--append')
    expect(cssContent).not.toContain('.picker-confirm-btn--cancel')
  })
})

describe('style-guards: Base UI mobile touch target contract in recipes.css', () => {
  const recipesPath = path.resolve(
    import.meta.dir,
    '../components/ui/recipes.css'
  )
  const recipesContent = fs.readFileSync(recipesPath, 'utf8')

  it('decouples mobile touch targets on coarse pointers while preserving compact visual density', () => {
    const mobileSection = recipesContent.slice(
      recipesContent.indexOf('@media (pointer: coarse)')
    )
    expect(mobileSection).toContain('.ui-button--icon')
    expect(mobileSection).toContain('var(--touch-target, 40px)')
  })

  it('provides invisible >=44px hit expansion on checkbox and radio without inflating visual glyphs', () => {
    expect(recipesContent).toContain('.ui-checkbox::after {')
    expect(recipesContent).toContain('.ui-radio::after {')
    expect(recipesContent).toContain('min-width: 44px;')
    expect(recipesContent).toContain('min-height: 44px;')

    // Visual dimensions remain compact 18px
    expect(recipesContent).toContain('.ui-checkbox {')
    expect(recipesContent).toContain('width: 18px;')
    expect(recipesContent).toContain('height: 18px;')
    expect(recipesContent).toContain('.ui-radio {')
    expect(recipesContent).toContain('width: 18px;')
    expect(recipesContent).toContain('height: 18px;')
  })
})

describe('style-guards: segmented view controls and multi-line row geometry', () => {
  const cssPath = path.resolve(import.meta.dir, '../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')
  const recipesPath = path.resolve(
    import.meta.dir,
    '../components/ui/recipes.css'
  )
  const recipesContent = fs.readFileSync(recipesPath, 'utf8')

  it('rejects unmapped segment buttons by proving .segmented recipe defines complete button states', () => {
    expect(cssContent).toContain('.segmented')
    expect(cssContent).toContain('.segmented > button')
    expect(cssContent).toContain(".segmented > button[aria-pressed='true']")
    expect(cssContent).toContain('.segmented > button:hover')
    expect(cssContent).toContain('.segmented > button:focus-visible')
    expect(cssContent).toContain('.view-switch .header-desktop-only')
  })

  it('rejects fixed height on multi-line space-drawer-item and enforces intrinsic height auto', () => {
    expect(cssContent).toContain('.space-drawer-item')
    expect(cssContent).toContain('height: auto;')
    expect(cssContent).toContain('min-height: 58px;')
    expect(recipesContent).toContain(
      '.ui-button--default-size.space-drawer-item'
    )
    expect(recipesContent).toContain('height: auto;')
  })
})

describe('style-guards: Select positioning and layer stacking context ownership', () => {
  const selectPath = path.resolve(
    import.meta.dir,
    '../components/ui/select.tsx'
  )
  const selectContent = fs.readFileSync(selectPath, 'utf8')
  const recipesPath = path.resolve(
    import.meta.dir,
    '../components/ui/recipes.css'
  )
  const recipesContent = fs.readFileSync(recipesPath, 'utf8')
  const appCssPath = path.resolve(import.meta.dir, '../app.css')
  const appCssContent = fs.readFileSync(appCssPath, 'utf8')

  it('rejects inline zIndex 100 on BaseSelect.Positioner and enforces canonical .ui-select__positioner class', () => {
    expect(selectContent).not.toContain('zIndex: 100')
    expect(selectContent).not.toContain('style={{ zIndex')
    expect(selectContent).toContain('className="ui-select__positioner"')
  })

  it('proves .ui-select__positioner and .ui-select__popup inherit var(--ui-layer-popover)', () => {
    expect(recipesContent).toContain('.ui-select__positioner {')
    expect(recipesContent).toContain('z-index: var(--ui-layer-popover);')
    expect(recipesContent).toContain('.ui-select__popup {')
    expect(recipesContent).toContain('z-index: var(--ui-layer-popover);')
    expect(recipesContent).toContain('background-color: var(--color-bg-panel);')
    expect(appCssContent).toContain('--color-bg-panel:')
  })
})
