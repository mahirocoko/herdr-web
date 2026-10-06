import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet.tsx'

describe('Base UI Drawer Sheet Contract and Defect Guards', () => {
  const recipesCssPath = path.resolve(
    import.meta.dir,
    '../components/ui/recipes.css',
  )
  const recipesCss = fs.readFileSync(recipesCssPath, 'utf8')

  const appCssPath = path.resolve(import.meta.dir, '../app.css')
  const appCss = fs.readFileSync(appCssPath, 'utf8')

  const appTsxPath = path.resolve(import.meta.dir, '../app.tsx')
  const appTsx = fs.readFileSync(appTsxPath, 'utf8')

  const spaceDrawerTsxPath = path.resolve(
    import.meta.dir,
    '../components/space-drawer.tsx',
  )
  const spaceDrawerTsx = fs.readFileSync(spaceDrawerTsxPath, 'utf8')

  const sheetTsxPath = path.resolve(
    import.meta.dir,
    '../components/ui/sheet.tsx',
  )
  const sheetTsx = fs.readFileSync(sheetTsxPath, 'utf8')

  describe('1. Component Exports and API Integrity', () => {
    test('keeps the drag handle outside Drawer.Content so Base UI accepts mouse dragging', () => {
      const popupStart = sheetTsx.indexOf('<Drawer.Popup')
      const handle = sheetTsx.indexOf(
        'className="drawer-sheet__handle"',
        popupStart,
      )
      const contentStart = sheetTsx.indexOf('<Drawer.Content', popupStart)
      expect(handle).toBeGreaterThan(popupStart)
      expect(handle).toBeLessThan(contentStart)
      for (const consumer of [
        'pane-drawer',
        'attention-horizon',
        'navigation-search-sheet',
        'interaction-picker-sheet',
      ]) {
        const source = fs.readFileSync(
          path.resolve(import.meta.dir, `../components/${consumer}.tsx`),
          'utf8',
        )
        expect(source).not.toContain('className="drawer-sheet__handle"')
      }
    })

    test('exports expected Drawer-backed Sheet primitives', () => {
      expect(typeof Sheet).toBe('function')
      expect(typeof SheetContent).toBe('function')
      expect(typeof SheetHeader).toBe('function')
      expect(typeof SheetTitle).toBe('function')
      expect(typeof SheetDescription).toBe('function')
      expect(typeof SheetClose).toBe('function')
      expect(typeof SheetTrigger).toBe('function')
    })

    test('sheet.tsx wraps @base-ui/react/drawer primitives', () => {
      expect(sheetTsx).toContain("import { Drawer } from '@base-ui/react/drawer'")
      expect(sheetTsx).toContain('<Drawer.Root')
      expect(sheetTsx).toContain('<Drawer.Portal')
      expect(sheetTsx).toContain('<Drawer.Backdrop')
      expect(sheetTsx).toContain('<Drawer.Viewport')
      expect(sheetTsx).toContain('<Drawer.Popup')
      expect(sheetTsx).toContain('<Drawer.Content')
      expect(sheetTsx).toContain('<Drawer.Title')
      expect(sheetTsx).toContain('<Drawer.Description')
      expect(sheetTsx).toContain('<Drawer.Close')
    })

    test('maps swipeDirection truthfully according to side', () => {
      expect(sheetTsx).toContain(
        "const swipeDirection = side === 'left' ? 'left' : 'down'",
      )
      expect(sheetTsx).toContain('swipeDirection={swipeDirection}')
    })
  })

  describe('2. Drawer Recipes & CSS Variable Consumption', () => {
    test('provides distinct viewport containers for bottom and left orientations', () => {
      expect(recipesCss).toContain('.ui-sheet__viewport')
      expect(recipesCss).toContain('.ui-sheet__viewport--bottom')
      expect(recipesCss).toContain('.ui-sheet__viewport--left')
      expect(recipesCss).toContain('z-index: var(--ui-layer-sheet)')
    })

    test('bottom popup consumes --drawer-swipe-movement-y and enables touch-action', () => {
      expect(recipesCss).toContain(
        'transform: translateY(var(--drawer-swipe-movement-y, 0px))',
      )
      expect(recipesCss).toContain('.ui-sheet--bottom[data-swiping]')
      expect(recipesCss).toContain(
        '.ui-sheet--bottom[data-starting-style]',
      )
    })

    test('left popup consumes --drawer-swipe-movement-x and enables touch-action', () => {
      expect(recipesCss).toContain(
        'transform: translateX(var(--drawer-swipe-movement-x, 0px))',
      )
      expect(recipesCss).toContain('.ui-sheet--left[data-swiping]')
      expect(recipesCss).toContain(
        '.ui-sheet--left[data-starting-style]',
      )
    })

    test('backdrop consumes --drawer-swipe-progress for truthful opacity fade', () => {
      expect(recipesCss).toContain(
        'opacity: calc(1 - var(--drawer-swipe-progress, 0))',
      )
      expect(recipesCss).toContain('.ui-sheet__backdrop[data-swiping]')
    })

    test('defines .ui-sheet__content flex scroll sizing', () => {
      expect(recipesCss).toContain('.ui-sheet__content {')
      expect(recipesCss).toContain('min-height: 0;')
      expect(recipesCss).toContain('flex: 1 1 auto;')
    })

    test('honors prefers-reduced-motion for drawer animations and transitions', () => {
      expect(recipesCss).toContain('@media (prefers-reduced-motion: reduce)')
      expect(recipesCss).toContain('transition: none !important;')
      expect(recipesCss).toContain('animation: none !important;')
    })
  })

  describe('3. Consumer Mapping & Direction Ownership', () => {
    test('Mobile Navigation Drawer passes side="left" to Sheet in app.tsx', () => {
      expect(appTsx).toMatch(/<Sheet\s+side="left"\s+open=\{isSpaceDrawerOpen\}/)
    })

    test('SpaceDrawer passes side="left" to Sheet in space-drawer.tsx', () => {
      expect(spaceDrawerTsx).toMatch(/<Sheet\s+side="left"\s+open=\{isOpen\}/)
    })
  })

  describe('4. Feature Scroll Containers and Gesture Arbitration', () => {
    const extractRuleBlock = (css: string, selector: string): string => {
      const escaped = selector.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
      const regex = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`, 'm')
      const match = css.match(regex)
      if (!match) {
        throw new Error(`CSS selector ${selector} not found`)
      }
      return match[1]
    }

    test('.space-drawer-sheet suppresses CSS keyframe animation during swiping', () => {
      const block = extractRuleBlock(appCss, '.space-drawer-sheet[data-swiping]')
      expect(block).toContain('animation: none !important')
      expect(block).toContain('transition-duration: 0ms !important')
    })

    test('.space-drawer-list allows native touch scrolling with containment', () => {
      const block = extractRuleBlock(appCss, '.space-drawer-list')
      expect(block).toContain('touch-action: auto')
      expect(block).toContain('overscroll-behavior: contain')
      expect(block).toContain('min-height: 0')
      expect(block).toContain('overflow-y: auto')
    })

    test('.drawer-sheet__panes-list allows native touch scrolling with containment', () => {
      const block = extractRuleBlock(appCss, '.drawer-sheet__panes-list')
      expect(block).toContain('touch-action: auto')
      expect(block).toContain('overscroll-behavior: contain')
      expect(block).toContain('min-height: 0')
      expect(block).toContain('overflow-y: auto')
    })

    test('.attention-queue-list allows native touch scrolling with containment', () => {
      const block = extractRuleBlock(appCss, '.attention-queue-list')
      expect(block).toContain('touch-action: auto')
      expect(block).toContain('overscroll-behavior: contain')
      expect(block).toContain('min-height: 0')
      expect(block).toContain('overflow-y: auto')
    })

    test('.interaction-picker__body allows native touch scrolling with containment', () => {
      const block = extractRuleBlock(appCss, '.interaction-picker__body')
      expect(block).toContain('touch-action: auto')
      expect(block).toContain('overscroll-behavior: contain')
      expect(block).toContain('min-height: 0')
      expect(block).toContain('overflow-y: auto')
    })

    test('.navigation-search-results allows native touch scrolling with containment', () => {
      const block = extractRuleBlock(appCss, '.navigation-search-results')
      expect(block).toContain('touch-action: auto')
      expect(block).toContain('overscroll-behavior: contain')
      expect(block).toContain('min-height: 0')
      expect(block).toContain('overflow-y: auto')
    })
  })
})
