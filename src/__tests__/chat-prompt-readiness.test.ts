import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
// Execute the production App handler, not a separate routing proxy.
const source = readFileSync(new URL('../app.tsx', import.meta.url), 'utf8')
const handler = source.slice(
  source.indexOf('  const handleSubmitText ='),
  source.indexOf('  const handleSendKeys =')
)
const compiled = new Bun.Transpiler({ loader: 'tsx' }).transformSync(handler)
const submit = (
  interactive: { ready: boolean; unknown: boolean; prompt: null; error: null },
  dispatch: () => void
) =>
  new Function(
    'interactive',
    'dispatch',
    `
const selectedPaneId='p', targetResult={target:{paneId:'p',expectedMode:'terminal'}}, viewMode='chat', canonicalHasAgent=true;
const markChatSend=()=>{}, setActionError=()=>{}, refreshSnapshot=async()=>{}, refetchActiveSurface=async()=>{}, isBusyRef={current:false}, setIsBusy=()=>{}, formatActionErrorMessage=String;
const sendAction=async()=>{dispatch();return 'acknowledged'}, executeGuardedAction=async opts=>opts.action();
${compiled}
return handleSubmitText('yes');
`
  )(interactive, dispatch) as Promise<string>
test('unread and re-enabled quarantined Chat cannot dispatch generic input; authoritative no-prompt read can', async () => {
  let writes = 0
  for (const state of [
    { ready: false, unknown: false },
    { ready: false, unknown: true },
    { ready: true, unknown: true }
  ])
    await expect(
      submit({ ...state, prompt: null, error: null }, () => writes++)
    ).rejects.toThrow()
  expect(writes).toBe(0)
  await submit(
    { ready: true, unknown: false, prompt: null, error: null },
    () => writes++
  )
  expect(writes).toBe(1)
})
