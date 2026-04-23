import { useEffect, useRef } from "react"

interface Point { px: number; py: number }

interface Session {
  cx: number; cy: number
  generated: Point[]
  visible: Point[]
  slope: number; intercept: number
  scale: number
  phase: "growing" | "holding" | "fading"
  holdStart: number
  alpha: number
}

function linReg(pts: Point[]): { slope: number; intercept: number } | null {
  const n = pts.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (const p of pts) { sx += p.px; sy += p.py; sxy += p.px * p.py; sxx += p.px * p.px }
  const d = n * sxx - sx * sx
  if (Math.abs(d) < 1e-9) return null
  return { slope: (n * sxy - sx * sy) / d, intercept: (sy - (n * sxy - sx * sy) / d * sx) / n }
}

function makeSession(w: number, h: number): Session {
  const scale = 70 + Math.random() * 70
  const slope = (Math.random() - 0.5) * 2.4
  const intercept = (Math.random() - 0.5) * scale * 0.6
  const n = 14 + Math.floor(Math.random() * 10)
  const generated: Point[] = Array.from({ length: n }, (_, i) => {
    const px = ((i / (n - 1)) - 0.5) * scale * 1.8
    const noise = (Math.random() - 0.5) * scale * 0.55
    return { px, py: slope * px + intercept + noise }
  })
  return {
    cx: w * (0.08 + Math.random() * 0.84),
    cy: h * (0.08 + Math.random() * 0.84),
    generated, visible: [], slope: 0, intercept: 0,
    scale, phase: "growing", holdStart: 0, alpha: 0,
  }
}

export default function RegressionCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf: number
    let sessions: Session[] = []
    let lastNewSession = 0
    let lastPoint = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    const tick = (ts: number) => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      if (activeRef.current) {
        if (sessions.length < 5 && ts - lastNewSession > 1200) {
          sessions.push(makeSession(w, h))
          lastNewSession = ts
        }
        if (ts - lastPoint > 160) {
          for (const s of sessions) {
            if (s.phase === "growing" && s.visible.length < s.generated.length) {
              s.visible.push(s.generated[s.visible.length])
              const reg = linReg(s.visible)
              if (reg) { s.slope = reg.slope; s.intercept = reg.intercept }
              break
            }
          }
          lastPoint = ts
        }
      }

      for (const s of sessions) {
        if (s.phase === "growing") {
          s.alpha = Math.min(1, s.alpha + 0.04)
          if (s.visible.length >= s.generated.length) {
            s.phase = "holding"
            s.holdStart = ts
          }
        } else if (s.phase === "holding") {
          if (ts - s.holdStart > 2800) s.phase = "fading"
        } else {
          s.alpha = Math.max(0, s.alpha - 0.012)
        }
        drawSession(ctx, s)
      }

      sessions = sessions.filter(s => !(s.phase === "fading" && s.alpha <= 0))
      if (!activeRef.current && sessions.length === 0) {
        raf = requestAnimationFrame(tick)
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 2 }}
    />
  )
}

function drawSession(ctx: CanvasRenderingContext2D, s: Session) {
  if (s.alpha <= 0 || s.visible.length === 0) return
  ctx.save()
  ctx.translate(s.cx, s.cy)
  const a = s.alpha

  for (const p of s.visible) {
    ctx.beginPath()
    ctx.arc(p.px, p.py, 2.2, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(96,165,250,${(a * 0.75).toFixed(3)})`
    ctx.fill()
  }

  if (s.visible.length >= 3) {
    const x1 = -s.scale * 1.0
    const x2 = s.scale * 1.0
    ctx.beginPath()
    ctx.moveTo(x1, s.slope * x1 + s.intercept)
    ctx.lineTo(x2, s.slope * x2 + s.intercept)
    ctx.strokeStyle = `rgba(186,230,253,${(a * 0.45).toFixed(3)})`
    ctx.lineWidth = 1.1
    ctx.stroke()
  }

  ctx.restore()
}
