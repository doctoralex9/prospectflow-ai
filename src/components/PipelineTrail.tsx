import { useEffect, useRef } from "react"

export type StepStatus = "pending" | "running" | "done" | "error"

export interface PipelineStep {
  label: string
  status: StepStatus
}

interface Props {
  steps: PipelineStep[]
  visible: boolean
}

const STEP_COLORS: Record<StepStatus, string> = {
  pending: "rgba(255,255,255,0.18)",
  running: "rgba(96,165,250,1)",
  done: "rgba(74,222,128,1)",
  error: "rgba(248,113,113,1)",
}

export default function PipelineTrail({ steps, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const tRef = useRef(0)
  const visibleRef = useRef(visible)
  const alphaRef = useRef(0)
  visibleRef.current = visible

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()
    window.addEventListener("resize", resize)

    const draw = () => {
      const logW = canvas.offsetWidth
      const logH = canvas.offsetHeight

      if (visibleRef.current) {
        alphaRef.current = Math.min(1, alphaRef.current + 0.035)
      } else {
        alphaRef.current = Math.max(0, alphaRef.current - 0.03)
      }

      tRef.current += 0.04

      ctx.clearRect(0, 0, logW, logH)

      const a = alphaRef.current
      if (a <= 0.01) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const n = steps.length
      const pad = 48
      const lineY = logH / 2
      const lineX1 = pad
      const lineX2 = logW - pad

      // Track line
      ctx.beginPath()
      ctx.moveTo(lineX1, lineY)
      ctx.lineTo(lineX2, lineY)
      ctx.strokeStyle = `rgba(255,255,255,${(a * 0.15).toFixed(3)})`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Progress fill
      const doneCount = steps.filter(s => s.status === "done").length
      const runIdx = steps.findIndex(s => s.status === "running")
      const progress = runIdx >= 0 ? (runIdx + 0.5) / (n - 1) : doneCount > 0 ? (doneCount - 1) / (n - 1) : 0
      if (progress > 0) {
        ctx.beginPath()
        ctx.moveTo(lineX1, lineY)
        ctx.lineTo(lineX1 + (lineX2 - lineX1) * progress, lineY)
        ctx.strokeStyle = `rgba(96,165,250,${(a * 0.55).toFixed(3)})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Step dots
      for (let i = 0; i < n; i++) {
        const step = steps[i]
        const x = n === 1 ? (lineX1 + lineX2) / 2 : lineX1 + ((lineX2 - lineX1) * i) / (n - 1)
        const color = STEP_COLORS[step.status]

        if (step.status === "running") {
          // Pulsing glow ring
          const pulse = 0.5 + 0.5 * Math.sin(tRef.current * 3)
          const glowR = 10 + pulse * 5
          const grad = ctx.createRadialGradient(x, lineY, 0, x, lineY, glowR)
          grad.addColorStop(0, `rgba(96,165,250,${(a * 0.35).toFixed(3)})`)
          grad.addColorStop(1, "rgba(96,165,250,0)")
          ctx.beginPath()
          ctx.arc(x, lineY, glowR, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()
        }

        // Outer ring
        ctx.beginPath()
        ctx.arc(x, lineY, step.status === "running" ? 5.5 : 4.5, 0, Math.PI * 2)
        ctx.strokeStyle = color.replace("1)", `${a.toFixed(3)})`)
        ctx.lineWidth = 1.4
        ctx.stroke()

        // Fill for done/running/error
        if (step.status !== "pending") {
          ctx.beginPath()
          ctx.arc(x, lineY, step.status === "running" ? 3.5 : 3, 0, Math.PI * 2)
          ctx.fillStyle = color.replace("1)", `${(a * 0.85).toFixed(3)})`)
          ctx.fill()
        }

        // Error X
        if (step.status === "error") {
          const s = 2.5
          ctx.beginPath()
          ctx.moveTo(x - s, lineY - s)
          ctx.lineTo(x + s, lineY + s)
          ctx.moveTo(x + s, lineY - s)
          ctx.lineTo(x - s, lineY + s)
          ctx.strokeStyle = `rgba(248,113,113,${a.toFixed(3)})`
          ctx.lineWidth = 1.4
          ctx.stroke()
        }

        // Label
        ctx.font = `11px system-ui, sans-serif`
        ctx.fillStyle = `rgba(180,200,230,${(a * 0.7).toFixed(3)})`
        ctx.textAlign = "center"
        ctx.fillText(step.label, x, lineY + 18)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("resize", resize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])

  return (
    <canvas
      ref={canvasRef}
      className="fixed bottom-0 left-0 right-0 pointer-events-none"
      style={{ height: 56, width: "100%", zIndex: 20 }}
    />
  )
}
