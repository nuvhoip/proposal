'use client'

import React, { useRef } from 'react'

/* Hand-drawn signature capture — a plain <canvas> (no drawing library needed)
   using pointer events so it works with mouse, pen, and touch alike. Restores
   a previously-saved PNG data URL on mount so re-visiting this step (or
   re-opening a saved draft) doesn't wipe out the signature.

   Shared by the internal wizard's Terms & Conditions step (Quote Approval
   signature block) and the public accept-proposal page, so the client signs
   with the exact same drawing surface Nuvho staff use when configuring the
   proposal's signature — one implementation instead of two diverging ones. */
export function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const inkedRef   = useRef(!!value)

  // The pad stretches full width, so the canvas's drawing buffer is sized to
  // match its rendered width (rather than a fixed px value) — otherwise
  // strokes would misalign with the pointer once the CSS width and the
  // canvas's internal coordinate space diverge. Re-measured on window resize
  // too, redrawing any saved signature at the new size.
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function resize() {
      if (!canvas) return
      const width = Math.round(canvas.getBoundingClientRect().width)
      if (!width || canvas.width === width) return
      canvas.width = width
      canvas.height = 140
      const ctx = canvas.getContext('2d')
      if (ctx && value) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        img.src = value
      }
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
    // Deliberately not re-run on every `value` change — strokes already
    // update it via onChange as the user draws; we only need it to restore
    // the signature on mount/resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    ctx.strokeStyle = '#28687F'
    ctx.lineWidth   = 2.25
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    inkedRef.current = true
  }

  function end() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas && inkedRef.current) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    inkedRef.current = false
    onChange('')
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        height={140}
        className="signature-pad__canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="signature-pad__footer">
        <span className="signature-pad__hint">Draw with your mouse, pen, or finger</span>
        <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={clear}>Clear</button>
      </div>

      <style jsx>{`
        .signature-pad__canvas {
          display: block; width: 100%; height: 140px;
          background: white; border: 1.5px dashed var(--nv-border);
          border-radius: 8px; cursor: crosshair; touch-action: none;
        }
        .signature-pad__footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 6px;
        }
        .signature-pad__hint { font-size: 11px; color: var(--nv-text-muted); font-style: italic; }
      `}</style>
    </div>
  )
}
