import { expect, mock, test } from 'claude-code/testing'

import { SCENES } from '../hooks/scenes.js'

const PERIOD_MS = 5 * 60_000

const BACKDROP = {
  plugin: 'aurora-dawn',
  component: 'Backdrop',
  props: { scene: 'aurora-dawn', plugin: 'aurora-dawn', glass: { blur: 0, opacity: 0.6 } },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('every scene is one still document that fits a window of any shape and both modes', async () => {
  expect(SCENES.length).toBeGreaterThan(0)
  expect(new Set(SCENES.map(scene => scene.id)).size).toBe(SCENES.length)
  for (const scene of SCENES) {
    // One Svg may hold 131072 characters.
    expect(scene.svg.length).toBeLessThanOrEqual(131072)
    // Scaled to the window's height and pinned to its foot, where the art is; the sides are cut to fit.
    expect(scene.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 160" width="100%" height="100%" preserveAspectRatio="xMidYMax slice">')).toBe(true)
    expect(scene.svg.endsWith('</svg>')).toBe(true)
    // The day picture shows unless the window is dark.
    expect(scene.svg).toContain('.n{display:none}@media (prefers-color-scheme:dark){.d{display:none}.n{display:inline}}')
    expect(scene.svg).toContain('<g class="d"><rect width="512" height="160"')
    expect(scene.svg).toContain('<g class="n"><rect width="512" height="160"')
    // Nothing in it moves or runs.
    expect(/animation|@keyframes|<script|<animate|\son[a-z]+=/.test(scene.svg)).toBe(false)
    // Only what the app's own example scenes use.
    expect([...new Set(scene.svg.match(/<[a-zA-Z]+/g))].every(tag => ['<svg', '<style', '<defs', '<pattern', '<g', '<path', '<rect'].includes(tag))).toBe(true)
  }
})

/** Stands in for the engine: a clock, a store, and a theme that a window draws. */
type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

function engine(on: On, kept: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 0 })
  const themes: unknown[] = []

  on('theme.set', (_, e) => {
    themes.push(e)

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('command.register', () => ({ value: { command: 'scene' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete kept[e.key]

    return { value: undefined }
  })

  return { clock, themes, kept }
}

test('the backdrop is named at the start, and the scenes take turns by the clock', async ($, on) => {
  const { clock, themes } = engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The scene's name is sent under both names a window may read.
  expect(themes).toEqual([{ backdrop: { scene: 'aurora-dawn', id: 'aurora-dawn', glass: { blur: 0, opacity: 0.6 } } }])

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    const svg = await ui.find({ type: 'Svg' })

    expect(svg?.props.source).toBe(SCENES[0]!.svg)
    expect(svg?.props.alt).toBe(`${SCENES[0]!.name}, in dithered pixels`)
    await ui.unmount()
  }

  // Five minutes on, the clock has crossed into the next scene's turn.
  await clock.advance(PERIOD_MS)
  const later = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })

  expect((await later.find({ type: 'Svg' }))?.props.source).toBe(SCENES[1 % SCENES.length]!.svg)
  await later.unmount()
})

test('the command lists the scenes, moves on, stays on one and takes turns again', async ($, on) => {
  const { kept } = engine(on)
  const showing = async () => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const source = (await ui.find({ type: 'Svg' }))?.props.source

    await ui.unmount()

    return SCENES.find(scene => scene.svg === source)?.id
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const listed = await $.command.run({ command: 'scene', args: '', ...RUN })

  expect(listed.text).toContain(`${SCENES[0]!.name} (showing)`)
  expect(listed.text).toContain('They take turns, 5 minutes each.')

  await $.command.run({ command: 'scene', args: 'next', ...RUN })
  expect(await showing()).toBe(SCENES[1 % SCENES.length]!.id)

  // A name stays on that scene, and the choice is kept for other sessions.
  const last = SCENES[SCENES.length - 1]!
  const stayed = await $.command.run({ command: 'scene', args: last.name.toUpperCase(), ...RUN })

  expect(stayed.text).toContain(`Staying on ${last.name}.`)
  expect(kept['pinned']).toBe(last.id)
  expect(await showing()).toBe(last.id)

  const unknown = await $.command.run({ command: 'scene', args: 'atlantis', ...RUN })

  expect(unknown.text).toContain('No scene is called "atlantis".')
  expect(await showing()).toBe(last.id)

  await $.command.run({ command: 'scene', args: 'auto', ...RUN })
  expect(kept['pinned']).toBe(undefined)
  expect(await showing()).toBe(SCENES[0]!.id)
})

test('a scene stayed on in another session is taken up at the start', async ($, on) => {
  const last = SCENES[SCENES.length - 1]!

  engine(on, { pinned: last.id })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })

  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(last.svg)
  await ui.unmount()
})

test("another mod's scene is left to it", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>theirs</Text>
  })

  const ui = await $.ui.mount({
    ...BACKDROP,
    surface: 'desktop',
    props: { ...BACKDROP.props, scene: 'lagoon', plugin: 'someone-else' },
  })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('theirs')
  await ui.unmount()
})
