import type { EngineInterface, Register } from 'claude-code'

import { SCENES } from './scenes.js'

// How long one scene stays up before the next takes its turn.
const MINUTES_PER_SCENE = 5

// How much of the app's own panel colour lies over the picture where a panel
// (the message box, a card) sits on it, 0 to 1. The chat text itself has no
// panel: it sits straight on the picture, which is why every scene keeps low.
const VEIL = 0.6

// A file the theme writes what it did to, for checking it from outside the
// app; empty, it writes nowhere.
const REPORT_FILE = ''

// The backdrop's name to the app. One name for every scene: which picture is
// drawn is this module's own business.
const NAME = 'aurora-dawn'
const COMMAND = 'scene'
// Where the scene a person chose to stay on is kept, across sessions.
const PIN = 'pinned'
const PERIOD_MS = MINUTES_PER_SCENE * 60_000

// Whether a window has said it draws the backdrop, the scene stayed on (if
// any), and how many turns `/scene next` has skipped in this session.
let isShown = false
// How often the backdrop has been drawn since it was last named: once a window has asked for it, it is in view
// whatever the naming's own answer said.
let drawnSinceSet = 0
let pinned: string | undefined
let skipped = 0
const seen = { starts: 0, theme: 'not set yet', asks: 0, drawn: 0, last: 'none yet' }

function key(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The scene a typed name means: its id or its name, in any case, or the start of either. */
function sceneNamed(text: string) {
  const wanted = key(text)

  if (wanted === '') {
    return undefined
  }

  return (
    SCENES.find(scene => key(scene.id) === wanted || key(scene.name) === wanted) ??
    SCENES.find(scene => key(scene.id).startsWith(wanted) || key(scene.name).startsWith(wanted))
  )
}

/** The scene showing at a moment: the one stayed on, else whose turn the clock says it is. */
function sceneAt(now: number) {
  const stay = SCENES.find(scene => scene.id === pinned)

  if (stay !== undefined) {
    return stay
  }
  const turn = Math.floor(now / PERIOD_MS) + skipped

  return SCENES[((turn % SCENES.length) + SCENES.length) % SCENES.length]!
}

async function report($: EngineInterface) {
  if (REPORT_FILE === '') {
    return
  }
  try {
    const surfaces = await $.session.surfaces()

    await $.fs.write(
      REPORT_FILE,
      [
        `${$.plugin.name}: ${SCENES.length} scenes`,
        `session starts heard: ${seen.starts}`,
        `theme: ${seen.theme}`,
        `surfaces attached now: ${surfaces.length > 0 ? surfaces.join(', ') : 'none'}`,
        `backdrop asked for ${seen.asks} times, drawn ${seen.drawn} times`,
        `last: ${seen.last}`,
        '',
      ].join('\n'),
    )
  } catch {
    // The report is a convenience: the theme goes on without it.
  }
}

/** Reads the scene a person chose to stay on, in this session or another. Answers whether it changed. */
async function readPin($: EngineInterface) {
  const was = pinned

  try {
    const kept = await $.store.get(PIN)

    pinned = typeof kept === 'string' && SCENES.some(scene => scene.id === kept) ? kept : undefined
  } catch {
    // An unreadable store is no choice: the scenes take turns.
  }

  return pinned !== was
}

/**
 * Names the session's backdrop. No colours of its own: the app keeps its light and dark looks.
 *
 * The scene's name goes under two names at once, as the app's own theme examples send it: newer
 * engines and windows read `scene`, the ones before them `id`.
 */
async function setTheme($: EngineInterface, when: string) {
  try {
    // No blur: the pictures are made of hard pixels and should stay so behind a panel.
    const backdrop = { scene: NAME, id: NAME, glass: { blur: 0, opacity: VEIL } }

    drawnSinceSet = 0
    const set = await $.theme.set({ backdrop })

    isShown = set.isDrawn
    seen.theme = set.isDrawn ? `set at ${when}; a window says it draws themes` : `set at ${when}, but no window says it draws it: ${set.reason}`
  } catch (error) {
    seen.theme = `could not be set at ${when}: ${String(error)}`
  }
  await report($)
}

/** Redraws the backdrop as the clock crosses into the next scene's turn, then waits for the one after. */
async function armNextScene($: EngineInterface) {
  const now = await $.clock.now()
  const wait = PERIOD_MS - (now % PERIOD_MS) + 40

  $.clock.after(wait, () => {
    $.ui.invalidate('ui.render')
    void armNextScene($)
  })
}

function listing(now: number) {
  const showing = sceneAt(now)
  const names = SCENES.map(scene => (scene === showing ? `${scene.name} (showing)` : scene.name)).join(', ')
  const turns = pinned === undefined ? `They take turns, ${MINUTES_PER_SCENE} minutes each.` : `Staying on ${showing.name}.`

  return `${names}. ${turns} /${COMMAND} next moves on, /${COMMAND} <name> stays on one, /${COMMAND} auto takes turns again.`
}

export const register: Register = on => {
  // Neither a reload nor --resume keeps a backdrop, so it is set at every start.
  on('session.start', async ($, e, next) => {
    seen.starts += 1
    if (SCENES.length === 0) {
      return next(e)
    }
    await readPin($)
    await setTheme($, 'session start')
    try {
      await $.command.register({
        name: COMMAND,
        description: 'The picture behind the chat: alone it lists the scenes; "next" moves on, a scene\'s name stays on it, "auto" takes turns again',
        argumentHint: '[next | auto | name]',
      })
    } catch {
      // A name already taken costs the command, not the backdrop.
    }
    void armNextScene($)

    return next(e)
  })

  // What a set answers is what the attached windows said of themselves at that moment, and at a
  // start none may be listening yet: so until one says it draws the backdrop, each message sent
  // names it again. A message is also when a choice made in another session is taken up.
  on('prompt.submit', async ($, e, next) => {
    if (SCENES.length > 0) {
      // Not while a window is already drawing it: naming it again would only make the window start over.
      if (!isShown && drawnSinceSet === 0) {
        await setTheme($, 'a message')
      }
      if (await readPin($)) {
        $.ui.invalidate('ui.render')
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    // An older window asks by `id` where a newer one asks by `scene`.
    const asked: { scene?: unknown; id?: unknown } = e.props
    const name = typeof asked.scene === 'string' ? asked.scene : asked.id

    seen.asks += 1
    // Every mod's backdrop comes through here: draw this one alone, and only where there is a window behind the chat.
    if (name !== NAME || SCENES.length === 0 || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      seen.last = `passed on an ask for "${String(name)}" on ${e.surface}`
      void report($)

      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const now = await $.clock.now()
    const scene = sceneAt(now)

    seen.drawn += 1
    drawnSinceSet += 1
    seen.last = `drew ${scene.name} on ${e.surface} at ${new Date(now).toISOString()}`
    void report($)

    // The one document holds a day and a night picture and picks by the window's own light or dark mode.
    return <Svg source={scene.svg} alt={`${scene.name}, in dithered pixels`} isInteractive />
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const now = await $.clock.now()
    const asked = e.args.trim()

    if (asked === '') {
      return { text: listing(now) }
    }
    if (key(asked) === 'next') {
      // From wherever it stands, the one after: a scene stayed on is let go.
      const at = SCENES.indexOf(sceneAt(now))
      const turn = Math.floor(now / PERIOD_MS)

      pinned = undefined
      skipped = at + 1 - turn
      await $.store.delete(PIN)
    } else if (key(asked) === 'auto') {
      pinned = undefined
      skipped = 0
      await $.store.delete(PIN)
    } else {
      const scene = sceneNamed(asked)

      if (scene === undefined) {
        return { text: `No scene is called "${asked}". ${listing(now)}` }
      }
      pinned = scene.id
      await $.store.set(PIN, scene.id)
    }
    $.ui.invalidate('ui.render')

    return { text: listing(now) }
  })
}
