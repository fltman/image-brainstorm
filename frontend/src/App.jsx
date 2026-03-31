import { useState, useRef, useCallback, useEffect } from 'react'
import './index.css'

const STORAGE_KEY = 'image-brainstorm'
const HISTORY_KEY = 'image-brainstorm-history'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* quota exceeded */ }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch { /* quota exceeded */ }
}

const MODELS = [
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
]

function App() {
  const saved = useRef(loadState())
  const s = saved.current

  const [prompt, setPrompt] = useState(s?.prompt || '')
  const [model, setModel] = useState(s?.model || MODELS[0].id)
  const [cards, setCards] = useState(() => {
    // Restore cards, but drop any that were still loading
    return (s?.cards || []).filter(c => !c.loading).map(c => ({ ...c, error: undefined }))
  })
  const [refImages, setRefImages] = useState(s?.refImages || [])
  const [error, setError] = useState(null)
  const [paletteCollapsed, setPaletteCollapsed] = useState(s?.paletteCollapsed || false)
  const [palettePos, setPalettePos] = useState(s?.palettePos || { x: 16, y: 16 })
  const nextId = useRef(s?.nextId || 1)
  const nextZ = useRef(s?.nextZ || 1)
  const bringToFront = (id) => {
    const z = nextZ.current++
    setCards(prev => prev.map(c => c.id === id ? { ...c, z } : c))
  }

  // Persist to localStorage
  useEffect(() => {
    saveState({
      prompt, model, refImages, paletteCollapsed, palettePos,
      nextId: nextId.current, nextZ: nextZ.current,
      cards: cards.filter(c => !c.loading),
    })
  }, [prompt, model, cards, refImages, paletteCollapsed, palettePos])

  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState(() => loadHistory())

  const clearAll = () => {
    // Save current to history if there are cards
    if (cards.length > 0) {
      const session = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        cards: cards.filter(c => !c.loading),
        prompt,
        cardCount: cards.filter(c => !c.loading).length,
      }
      const updated = [session, ...sessions].slice(0, 20) // keep 20 max
      setSessions(updated)
      saveHistory(updated)
    }
    setCards([])
    setRefImages([])
    setError(null)
    setPrompt('')
    nextId.current = 1
    nextZ.current = 1
  }

  const restoreSession = (session) => {
    setCards(session.cards.map(c => ({ ...c, loading: false, error: undefined })))
    if (session.prompt) setPrompt(session.prompt)
    nextId.current = Math.max(...session.cards.map(c => c.id), 0) + 1
    nextZ.current = Math.max(...session.cards.map(c => c.z || 0), 0) + 1
    setShowHistory(false)
  }

  const deleteSession = (id) => {
    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    saveHistory(updated)
  }

  const fireGenerate = (overridePrompt) => {
    const text = overridePrompt || prompt.trim()
    if (!text) return
    const currentModel = model
    const currentRef = refImages.length > 0 ? refImages[0] : null
    const id = nextId.current++

    setError(null)

    // Place card avoiding the palette
    const paletteRight = palettePos.x + 320
    const baseX = paletteRight + 20
    const baseY = palettePos.y
    const offset = ((id - 1) * 30) % 150

    const z = nextZ.current++
    setCards(prev => [...prev, {
      id, prompt: text, image: null, filename: null, loading: true,
      x: baseX + offset, y: baseY + offset, z,
    }])

    const run = async () => {
      try {
        let res
        if (currentRef) {
          res = await fetch('/api/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: text, source_image: currentRef.filename, model: currentModel }),
          })
        } else {
          res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: text, model: currentModel }),
          })
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(err.detail || 'Generation failed')
        }
        const data = await res.json()
        // Replace placeholder with result
        setCards(prev => prev.map(c => c.id === id
          ? { ...c, image: data.image, filename: data.filename, loading: false }
          : c
        ))
      } catch (e) {
        // Mark placeholder as failed
        setCards(prev => prev.map(c => c.id === id
          ? { ...c, loading: false, error: e.message }
          : c
        ))
      }
    }
    run()
  }

  const [gridSize, setGridSize] = useState('5x5')
  const [variation, setVariation] = useState('random')

  const GRID_SIZES = [
    { id: 'none', label: 'Single image' },
    { id: '2x2', label: 'Grid 2x2' },
    { id: '3x3', label: 'Grid 3x3' },
    { id: '4x4', label: 'Grid 4x4' },
    { id: '5x5', label: 'Grid 5x5' },
  ]

  const VARIATIONS = [
    { id: 'random', label: 'Random variation', text: 'each exploring a completely different style, angle, mood, or interpretation' },
    { id: 'none', label: 'No variation' },
    { id: 'styles', label: 'Styles', text: 'each in a different style: photorealistic, oil painting, watercolor, digital illustration' },
    { id: 'angles', label: 'Camera angles', text: 'each from a different camera angle: front view, side profile, bird\'s eye view, dramatic low angle' },
    { id: 'moods', label: 'Moods', text: 'each with a different mood: bright and cheerful, dark and moody, warm sunset tones, cool blue hour' },
    { id: 'color', label: 'Color palettes', text: 'each with a different color palette: monochrome, complementary, analogous, triadic' },
    { id: 'time', label: 'Time of day', text: 'each at a different time of day: golden hour sunrise, harsh midday, blue hour dusk, moonlit night' },
    { id: 'detail', label: 'Detail levels', text: 'each at a different detail level: minimal/abstract, sketchy, detailed, hyperdetailed' },
  ]

  const generate = () => {
    if (!prompt.trim()) return
    if (gridSize === 'none') return fireGenerate()
    const grid = GRID_SIZES.find(g => g.id === gridSize)
    const vari = VARIATIONS.find(v => v.id === variation)
    let suffix = `. Show as a ${grid.id} grid`
    if (vari && vari.text) suffix += `, ${vari.text}`
    suffix += '.'
    fireGenerate(prompt.trim() + suffix)
  }

  const removeCard = (id) => setCards(prev => prev.filter(c => c.id !== id))

  const addRef = (filename, url) => {
    setRefImages(prev => {
      if (prev.find(r => r.filename === filename)) return prev
      return [...prev, { filename, url }]
    })
  }

  const removeRef = (filename) => {
    setRefImages(prev => prev.filter(r => r.filename !== filename))
  }

  return (
    <div className="app">
      {/* ── Floating Palette ── */}
      <div
        className={`palette ${paletteCollapsed ? 'collapsed' : ''}`}
        style={{ left: palettePos.x, top: palettePos.y }}
      >
        <div className="palette-titlebar" onMouseDown={(e) => {
          if (e.target.tagName === 'BUTTON') return
          e.preventDefault()
          const startX = e.clientX - palettePos.x
          const startY = e.clientY - palettePos.y
          const onMove = (e) => setPalettePos({ x: e.clientX - startX, y: e.clientY - startY })
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}>
          <span className="palette-title">Image Brainstorm</span>
          <button className="palette-toggle" onClick={() => setPaletteCollapsed(c => !c)}>
            {paletteCollapsed ? '+' : '\u2013'}
          </button>
        </div>

        {!paletteCollapsed && (
          <div className="palette-body">
            <select className="model-select" value={model} onChange={e => setModel(e.target.value)}>
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>

            {refImages.length > 0 && (
              <div className="ref-images">
                {refImages.map(r => (
                  <div key={r.filename} className="ref-thumb">
                    <img src={r.url} alt="" />
                    <button className="remove-ref" onClick={() => removeRef(r.filename)}>x</button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the image..."
              rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate() }}
            />

            <div className="select-row">
              <select className="model-select" value={gridSize} onChange={e => setGridSize(e.target.value)}>
                {GRID_SIZES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <select className="model-select" value={variation} onChange={e => setVariation(e.target.value)}
                disabled={gridSize === 'none'}>
                {VARIATIONS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>

            <button className="btn-primary" onClick={generate} disabled={!prompt.trim()}>
              Generate
            </button>

            <div className="btn-row">
              <button className="btn-secondary" onClick={clearAll}>
                New board
              </button>
              <button className="btn-secondary" onClick={() => setShowHistory(h => !h)}>
                History ({sessions.length})
              </button>
            </div>

            {showHistory && sessions.length > 0 && (
              <div className="history-panel">
                {sessions.map(ses => (
                  <div key={ses.id} className="history-item">
                    <div className="history-info" onClick={() => restoreSession(ses)}>
                      <span>{ses.date}</span>
                      <span className="history-count">{ses.cardCount} images</span>
                    </div>
                    <button className="btn-icon btn-icon-danger" onClick={() => deleteSession(ses.id)}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}
          </div>
        )}
      </div>

      {/* ── Canvas ── */}
      <main className="canvas"
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={async e => {
          e.preventDefault()
          const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))
          for (const file of files) {
            const form = new FormData()
            form.append('file', file)
            const res = await fetch('/api/upload', { method: 'POST', body: form })
            if (res.ok) {
              const data = await res.json()
              const id = nextId.current++
              setCards(prev => [...prev, {
                id, prompt: file.name, image: data.image, filename: data.filename,
                x: e.clientX - 140, y: e.clientY - 140,
              }])
            }
          }
        }}
      >
        {cards.map(card => (
          <ImageCard
            key={card.id}
            card={card}
            onFocus={() => bringToFront(card.id)}
            onMove={(id, x, y) => setCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c))}
            onRemove={removeCard}
            onCrop={async (filename, crop) => {
              const res = await fetch('/api/crop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_image: filename, ...crop }),
              })
              if (res.ok) {
                const data = await res.json()
                addRef(data.filename, data.image)
              }
            }}
            onUseAsRef={addRef}
            onReusePrompt={(p) => setPrompt(p)}
          />
        ))}
        {cards.length === 0 && (
          <div className="canvas-empty">
            Write a prompt and hit Generate to start brainstorming
          </div>
        )}
      </main>
    </div>
  )
}

function ImageCard({ card, onFocus, onMove, onRemove, onCrop, onUseAsRef, onReusePrompt }) {
  const imgRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [selection, setSelection] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const selStart = useRef(null)

  const onHeaderMouseDown = useCallback((e) => {
    if (e.target.tagName === 'BUTTON') return
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX - card.x
    const startY = e.clientY - card.y

    const onMouseMove = (e) => onMove(card.id, e.clientX - startX, e.clientY - startY)
    const onMouseUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [card.id, card.x, card.y, onMove])

  const onImageMouseDown = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = imgRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    selStart.current = { x: sx, y: sy, rect }
    setSelection({ x: sx, y: sy, w: 0, h: 0 })

    const onMouseMove = (e) => {
      const cx = e.clientX - selStart.current.rect.left
      const cy = e.clientY - selStart.current.rect.top
      setSelection({
        x: Math.min(sx, cx), y: Math.min(sy, cy),
        w: Math.abs(cx - sx), h: Math.abs(cy - sy),
      })
    }
    const onMouseUp = (e) => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      const cx = e.clientX - selStart.current.rect.left
      const cy = e.clientY - selStart.current.rect.top
      const w = Math.abs(cx - sx)
      const h = Math.abs(cy - sy)
      if (w > 10 && h > 10) {
        const img = imgRef.current
        const scaleX = img.naturalWidth / img.width
        const scaleY = img.naturalHeight / img.height
        onCrop(card.filename, {
          x: Math.round(Math.min(sx, cx) * scaleX),
          y: Math.round(Math.min(sy, cy) * scaleY),
          width: Math.round(w * scaleX),
          height: Math.round(h * scaleY),
        })
      }
      setSelection(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [card.filename, onCrop])

  return (
    <div
      className={`card ${dragging ? 'dragging' : ''}`}
      style={{ left: card.x, top: card.y, zIndex: card.z || 0 }}
      onMouseDown={onFocus}
    >
      <div className="card-header" onMouseDown={onHeaderMouseDown}>
        <button className="btn-icon" title={minimized ? 'Expand' : 'Minimize'} onClick={() => setMinimized(m => !m)}>
          {minimized ? '+' : '\u2013'}
        </button>
        {!minimized && (
          <button className="btn-icon" title="Show prompt" onClick={() => setShowPrompt(s => !s)}>
            {showPrompt ? '\u25B4' : '\u25BE'}
          </button>
        )}
        {!card.loading && !card.error && !minimized && (
          <button className="btn-icon" title="Use as reference" onClick={() => onUseAsRef(card.filename, card.image)}>
            &#x1f4cc;
          </button>
        )}
        <button className="btn-icon" title="Reuse prompt" onClick={() => onReusePrompt(card.prompt)}>
          &#x21BB;
        </button>
        <button className="btn-icon btn-icon-danger" title="Remove" onClick={() => onRemove(card.id)}>
          &times;
        </button>
        {card.loading && <span className="spinner" style={{ marginLeft: 'auto' }} />}
      </div>
      {!minimized && <>
        {showPrompt && (
          <div className="card-prompt">{card.prompt}</div>
        )}
        {card.loading ? (
          <div className="card-loading">
            <span>Generating...</span>
          </div>
        ) : card.error ? (
          <div className="card-error">{card.error}</div>
        ) : (
          <div className="card-image-wrap" onMouseDown={onImageMouseDown}>
            <img ref={imgRef} src={card.image} alt={card.prompt} draggable={false} />
            {selection && selection.w > 0 && (
              <div className="selection-box" style={{
                left: selection.x, top: selection.y,
                width: selection.w, height: selection.h,
              }} />
            )}
          </div>
        )}
      </>}
    </div>
  )
}

export default App
