import { useCallback, useEffect, useRef, useState } from 'react'

type Category = 'mouse' | 'trackpad' | 'touch' | 'keyboard'

type LogEntry = {
  id: number
  category: Category
  type: string
  detail: string
  time: string
}

const MAX_ENTRIES = 200
const CATEGORIES: Category[] = ['mouse', 'trackpad', 'touch', 'keyboard']
const ZERO: Record<Category, number> = { mouse: 0, trackpad: 0, touch: 0, keyboard: 0 }
const ALL_ON: Record<Category, boolean> = { mouse: true, trackpad: true, touch: true, keyboard: true }
const MOUSE_EVENTS = ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']
const TRACKPAD_EVENTS = ['wheel', 'gesturestart', 'gesturechange', 'gestureend']
const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel']
const KEY_EVENTS = ['keydown', 'keyup']
const CATEGORY_OF = new Map<string, Category>([
  ...MOUSE_EVENTS.map((t) => [t, 'mouse'] as const),
  ...TRACKPAD_EVENTS.map((t) => [t, 'trackpad'] as const),
  ...TOUCH_EVENTS.map((t) => [t, 'touch'] as const),
  ...KEY_EVENTS.map((t) => [t, 'keyboard'] as const),
])
const BUTTON_BITS: [number, string][] = [
  [1, 'Left button'],
  [4, 'Middle button'],
  [2, 'Right button'],
  [8, 'Back button'],
  [16, 'Forward button'],
]
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])
const ACTIVITY_MS = 250
const BUTTON_NAMES = ['left', 'middle', 'right', 'back', 'forward']

function modifiers(e: MouseEvent | TouchEvent | KeyboardEvent) {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean)
  return mods.length ? ` +${mods.join('+')}` : ''
}

function describeMouse(e: MouseEvent, stage: HTMLElement) {
  const rect = stage.getBoundingClientRect()
  const x = Math.round(e.clientX - rect.left)
  const y = Math.round(e.clientY - rect.top)
  const withButton = e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click'
  const button = withButton ? `, ${BUTTON_NAMES[e.button] ?? e.button}` : ''
  return `x ${x}, y ${y}${button}${modifiers(e)}`
}

function describeTrackpad(e: Event, stage: HTMLElement) {
  if (e instanceof WheelEvent) {
    const rect = stage.getBoundingClientRect()
    const kind = e.ctrlKey ? 'pinch zoom' : 'scroll'
    return `${kind}, x ${Math.round(e.clientX - rect.left)}, y ${Math.round(e.clientY - rect.top)}, Δx ${Math.round(e.deltaX)}, Δy ${Math.round(e.deltaY)}${e.ctrlKey ? '' : modifiers(e)}`
  }
  const g = e as Event & { scale?: number; rotation?: number }
  return `scale ${g.scale?.toFixed(2) ?? '?'}, rotation ${g.rotation?.toFixed(1) ?? '?'}°`
}

function describeTouch(e: TouchEvent, stage: HTMLElement) {
  const rect = stage.getBoundingClientRect()
  const points = Array.from(e.touches).map(
    (t) => `(${Math.round(t.clientX - rect.left)}, ${Math.round(t.clientY - rect.top)})`,
  )
  return `${e.touches.length} active${points.length ? ` ${points.join(' ')}` : ''}${modifiers(e)}`
}

const keyLabel = (e: KeyboardEvent) => (e.key === ' ' ? 'Space' : e.key)

function describeKey(e: KeyboardEvent) {
  return `key "${keyLabel(e)}", code ${e.code}${e.repeat ? ', repeat' : ''}${modifiers(e)}`
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
})

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)
  const pausedRef = useRef(false)
  const hoverRef = useRef(false)
  const ignoredRef = useRef<Set<string>>(new Set())
  const enabledRef = useRef<Record<Category, boolean>>(ALL_ON)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [counts, setCounts] = useState<Record<Category, number>>(ZERO)
  const [enabled, setEnabled] = useState<Record<Category, boolean>>(ALL_ON)
  const [paused, setPaused] = useState(false)
  const [ignored, setIgnored] = useState<string[]>([])
  const [menu, setMenu] = useState<{ type: string; x: number; y: number } | null>(null)
  const [buttons, setButtons] = useState(0)
  const [activity, setActivity] = useState<string[]>([])
  const activityTimers = useRef(new Map<string, number>())
  const [pressed, setPressed] = useState<string[]>([])
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [touches, setTouches] = useState<{ id: number; x: number; y: number }[]>([])

  useEffect(() => {
    pausedRef.current = paused
    enabledRef.current = enabled
    ignoredRef.current = new Set(ignored)
  }, [paused, enabled, ignored])

  const markActivity = useCallback((label: string) => {
    const timers = activityTimers.current
    window.clearTimeout(timers.get(label))
    setActivity((a) => (a.includes(label) ? a : [...a, label]))
    timers.set(
      label,
      window.setTimeout(() => {
        timers.delete(label)
        setActivity((a) => a.filter((x) => x !== label))
      }, ACTIVITY_MS),
    )
  }, [])

  const record = useCallback((category: Category, type: string, detail: string) => {
    setCounts((c) => ({ ...c, [category]: c[category] + 1 }))
    if (pausedRef.current || !enabledRef.current[category]) return
    if (ignoredRef.current.has(type)) return
    const entry: LogEntry = { id: nextId.current++, category, type, detail, time: timeFormat.format(new Date()) }
    setEntries((list) => [entry, ...list].slice(0, MAX_ENTRIES))
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const controller = new AbortController()
    const { signal } = controller

    const onMouse = (e: Event) => {
      const me = e as MouseEvent
      if (me.type === 'contextmenu') e.preventDefault()
      const rect = stage.getBoundingClientRect()
      setPointer({ x: Math.round(me.clientX - rect.left), y: Math.round(me.clientY - rect.top) })
      setButtons(me.buttons)
      if (me.type === 'mousemove') markActivity('moving')
      record('mouse', me.type, describeMouse(me, stage))
    }
    const onTrackpad = (e: Event) => {
      // Stop pinch/swipe from zooming or navigating the page while over the stage.
      e.preventDefault()
      if (e instanceof WheelEvent) markActivity(e.ctrlKey ? 'pinching' : 'scrolling')
      else if (e.type === 'gesturechange') markActivity('pinching')
      record('trackpad', e.type, describeTrackpad(e, stage))
    }
    const onTouch = (e: Event) => {
      const te = e as TouchEvent
      const rect = stage.getBoundingClientRect()
      setTouches(
        Array.from(te.touches).map((t) => ({ id: t.identifier, x: t.clientX - rect.left, y: t.clientY - rect.top })),
      )
      if (te.type === 'touchmove') markActivity('dragging')
      record('touch', te.type, describeTouch(te, stage))
    }
    const onKey = (e: Event) => {
      const ke = e as KeyboardEvent
      // Swallow keys while hovering the stage. Browser-reserved shortcuts (Cmd+Q, Cmd+W) can't be blocked by pages.
      if (hoverRef.current) {
        ke.preventDefault()
        ke.stopPropagation()
      }
      const label = keyLabel(ke)
      setPressed((keys) => {
        if (ke.type === 'keydown') return keys.includes(label) ? keys : [...keys, label]
        // macOS sends no keyup for keys released while Meta is held, so drop them with Meta.
        if (label === 'Meta') return keys.filter((k) => MODIFIER_KEYS.has(k) && k !== 'Meta')
        return keys.filter((k) => k !== label)
      })
      record('keyboard', ke.type, describeKey(ke))
    }

    for (const name of MOUSE_EVENTS) stage.addEventListener(name, onMouse, { signal })
    for (const name of TRACKPAD_EVENTS) stage.addEventListener(name, onTrackpad, { signal, passive: false })
    for (const name of TOUCH_EVENTS) stage.addEventListener(name, onTouch, { signal })
    for (const name of KEY_EVENTS) window.addEventListener(name, onKey, { signal, capture: true })
    window.addEventListener('mouseup', (e) => setButtons(e.buttons), { signal })
    stage.addEventListener('mouseenter', () => (hoverRef.current = true), { signal })
    window.addEventListener('blur', () => setPressed([]), { signal })
    stage.addEventListener(
      'mouseleave',
      () => {
        hoverRef.current = false
        setPointer(null)
      },
      { signal },
    )

    return () => controller.abort()
  }, [record, markActivity])

  const toggle = (category: Category) => setEnabled((e) => ({ ...e, [category]: !e[category] }))
  const ignore = (type: string) => {
    setIgnored((list) => (list.includes(type) ? list : [...list, type]))
    setEntries((list) => list.filter((e) => e.type !== type))
    setMenu(null)
  }
  const clear = () => {
    setEntries([])
    setCounts(ZERO)
  }

  const combo = [
    ...BUTTON_BITS.filter(([bit]) => buttons & bit).map(([, name]) => `${name} down`),
    ...pressed.map((k) => `${k} down`),
    ...activity,
  ]

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 7-6 2-2 6z" />
            </svg>
          </span>
          <span className="brand-name">detect.tkalve.dev</span>
        </div>
      </header>

      <main className="main">
        <div className="intro">
          <h1>Detect input events</h1>
          <p>Move, click, scroll, pinch or touch the area below, and press any key. Everything stays in your browser.</p>
        </div>

        <div className="grid">
          <section className="panel">
            <div ref={stageRef} className="stage" tabIndex={0} aria-label="Event capture area">
              <span className="stage-hint">Interact here</span>
              {pointer && <span className="cursor" style={{ left: pointer.x, top: pointer.y }} />}
              {touches.map((t) => (
                <span key={t.id} className="touch-dot" style={{ left: t.x, top: t.y }} />
              ))}
            </div>
            <div className="combo" aria-live="off">
              <span className="label">Active combo</span>
              <span className="value">
                {combo.length ? combo.map((c, i) => (
                  <span key={c} className="combo-part">
                    {i > 0 && <span className="plus">+</span>}
                    <kbd>{c}</kbd>
                  </span>
                )) : '—'}
              </span>
            </div>
            <div className="status">
              <div>
                <span className="label">Pointer</span>
                <span className="value">{pointer ? `${pointer.x}, ${pointer.y}` : '—'}</span>
              </div>
              <div>
                <span className="label">Touches</span>
                <span className="value">{touches.length}</span>
              </div>
              <div>
                <span className="label">Keys down</span>
                <span className="value">{pressed.length ? pressed.map((k) => <kbd key={k}>{k}</kbd>) : '—'}</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="toolbar">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${enabled[c] ? 'on' : ''}`}
                  aria-pressed={enabled[c]}
                  onClick={() => toggle(c)}
                >
                  {c} <span className="count">{counts[c]}</span>
                </button>
              ))}
              <span className="spacer" />
              <button
                type="button"
                className={`square-button record ${paused ? '' : 'live'}`}
                aria-pressed={!paused}
                aria-label={paused ? 'Start logging' : 'Stop logging'}
                title={paused ? 'Start logging' : 'Stop logging'}
                onClick={() => setPaused((v) => !v)}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path fill="currentColor" d="M17 17H7V7h10z" />
                  <path fill="currentColor" fillRule="evenodd" d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0m0 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2" clipRule="evenodd" />
                </svg>
              </button>
              <button type="button" className="square-button" aria-label="Clear log" title="Clear log" onClick={clear}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path fill="currentColor" fillRule="evenodd" d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0M5.67 19.742A9.96 9.96 0 0 0 12 22c5.523 0 10-4.477 10-10a9.96 9.96 0 0 0-2.258-6.33zM12 2C6.477 2 2 6.477 2 12c0 2.401.846 4.604 2.257 6.328L18.328 4.257A9.96 9.96 0 0 0 12 2" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <ul className="log">
              {entries.length === 0 && <li className="empty">No events yet.</li>}
              {entries.map((e) => (
                <li
                  key={e.id}
                  onContextMenu={(ev) => {
                    ev.preventDefault()
                    setMenu({ type: e.type, x: ev.clientX, y: ev.clientY })
                  }}
                >
                  <span className="time">{e.time}</span>
                  <span className={`tag ${e.category}`}>{e.type}</span>
                  <span className="detail">{e.detail}</span>
                </li>
              ))}
            </ul>
            {ignored.length > 0 && (
              <div className="ignored">
                <span className="label">Ignored</span>
                {ignored.map((t) => (
                  <span key={t} className={`tag ${CATEGORY_OF.get(t)} ignored-tag`}>
                    {t}
                    <button type="button" aria-label={`Stop ignoring ${t}`} onClick={() => setIgnored((l) => l.filter((x) => x !== t))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(ev) => { ev.preventDefault(); setMenu(null) }}>
          <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" onClick={() => ignore(menu.type)}>
              Ignore all {menu.type} events
            </button>
          </div>
        </div>
      )}

      <footer className="footer">
        <a href="https://github.com/tkalve/detect">Source on GitHub</a>
      </footer>
    </div>
  )
}
