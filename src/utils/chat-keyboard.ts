// MIT License - Copyright (c) 2026 devswha. Adapted from pinned lib/keyboard.ts.
export const dragDismisses = (dx: number, dy: number) =>
  dy >= 32 && dy > Math.abs(dx)
export const tapDismisses = (target: EventTarget | null, selection: string) => {
  if (selection.length) return false
  const element = target as Element | null
  return !element?.closest?.(
    'a,button,input,textarea,select,summary,label,[role="button"],[contenteditable="true"]'
  )
}
export const dismissKeyboardOn = (node: HTMLElement, atTopOnly = false) => {
  let start: { x: number; y: number } | null = null
  const up = () =>
    Boolean(document.querySelector('[data-keyboard-open="true"]'))
  const selection = () => window.getSelection()?.toString() ?? ''
  const dismiss = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
  }
  const touchStart = (event: TouchEvent) => {
    start = null
    if (atTopOnly) {
      for (
        let at = event.target as HTMLElement | null;
        at;
        at = at.parentElement
      ) {
        if (at.scrollTop > 0) return
        if (at === node) break
      }
    }
    const touch = event.touches[0]
    if (
      event.touches.length === 1 &&
      touch &&
      up() &&
      !selection() &&
      !(event.target as Element | null)?.closest?.(
        'input,textarea,select,[contenteditable="true"]'
      )
    )
      start = { x: touch.clientX, y: touch.clientY }
  }
  const touchMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!start || !touch) return
    if (selection()) {
      start = null
      return
    }
    if (dragDismisses(touch.clientX - start.x, touch.clientY - start.y)) {
      start = null
      dismiss()
    }
  }
  const click = (event: MouseEvent) => {
    if (up() && tapDismisses(event.target, selection())) dismiss()
  }
  node.addEventListener('touchstart', touchStart, { passive: true })
  node.addEventListener('touchmove', touchMove, { passive: true })
  node.addEventListener('click', click)
  return () => {
    node.removeEventListener('touchstart', touchStart)
    node.removeEventListener('touchmove', touchMove)
    node.removeEventListener('click', click)
  }
}
