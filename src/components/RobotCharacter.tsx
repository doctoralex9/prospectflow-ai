import { useEffect, useRef, useState } from "react"

export default function RobotCharacter() {
  const robotRef = useRef<SVGSVGElement>(null)
  const [eye, setEye] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const el = robotRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)
      const travel = Math.min(dist * 0.03, 3.5)
      setEye({ x: Math.cos(angle) * travel, y: Math.sin(angle) * travel })
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  return (
    <svg
      ref={robotRef}
      viewBox="0 0 100 148"
      width="110"
      height="163"
      xmlns="http://www.w3.org/2000/svg"
      className="animate-float drop-shadow-lg"
    >
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="bodyGrad" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#162033" />
          <stop offset="100%" stopColor="#0a1220" />
        </radialGradient>
        <radialGradient id="shadowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="50" cy="145" rx="32" ry="4" fill="url(#shadowGrad)" />

      {/* Antenna */}
      <line x1="50" y1="12" x2="50" y2="25" stroke="#528ba3" strokeWidth="2" strokeLinecap="round" />
      {/* Antenna LED — blinks */}
      <circle cx="50" cy="8" r="5" fill="#3b82f6" opacity="0.3" filter="url(#softglow)" className="animate-blink-led" />
      <circle cx="50" cy="8" r="3.5" fill="#528ba3" filter="url(#glow)" className="animate-blink-led" />
      <circle cx="50" cy="8" r="1.8" fill="white" opacity="0.95" />

      {/* Head */}
      <rect x="17" y="24" width="66" height="54" rx="13" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1.2" />
      {/* Head top sheen */}
      <rect x="21" y="26" width="58" height="14" rx="10" fill="white" opacity="0.03" />

      {/* Left eye socket */}
      <circle cx="36" cy="49" r="10.5" fill="#060e1a" />
      <circle cx="36" cy="49" r="8" fill="#0c1e32" />
      {/* Left pupil */}
      <circle cx={36 + eye.x} cy={49 + eye.y} r="4.5" fill="#3b82f6" filter="url(#glow)" />
      <circle cx={36 + eye.x + 1.5} cy={49 + eye.y - 1.5} r="1.3" fill="white" opacity="0.9" />

      {/* Right eye socket */}
      <circle cx="64" cy="49" r="10.5" fill="#060e1a" />
      <circle cx="64" cy="49" r="8" fill="#0c1e32" />
      {/* Right pupil */}
      <circle cx={64 + eye.x} cy={49 + eye.y} r="4.5" fill="#3b82f6" filter="url(#glow)" />
      <circle cx={64 + eye.x + 1.5} cy={49 + eye.y - 1.5} r="1.3" fill="white" opacity="0.9" />

      {/* Smile */}
      <path
        d="M 37 67 Q 50 75 63 67"
        stroke="#528ba3"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Neck connector */}
      <rect x="42" y="78" width="16" height="9" rx="3.5" fill="#0a1220" stroke="#528ba3" strokeWidth="0.9" />

      {/* Body */}
      <rect x="14" y="87" width="72" height="46" rx="11" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1.2" />
      {/* Body sheen */}
      <rect x="18" y="89" width="64" height="12" rx="8" fill="white" opacity="0.025" />

      {/* Chest panel */}
      <rect x="28" y="97" width="44" height="16" rx="5" fill="#060e1a" stroke="#1e3a5c" strokeWidth="0.8" />
      <circle cx="38" cy="105" r="2.8" fill="#1e3a5c" />
      <circle cx="50" cy="105" r="2.8" fill="#3b82f6" opacity="0.9" filter="url(#glow)" />
      <circle cx="62" cy="105" r="2.8" fill="#1e3a5c" />

      {/* Body lower bar */}
      <rect x="36" y="120" width="28" height="5" rx="2.5" fill="#060e1a" opacity="0.8" />

      {/* Left arm */}
      <rect x="2" y="89" width="12" height="32" rx="6" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />
      <circle cx="8" cy="124" r="5.5" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />

      {/* Right arm */}
      <rect x="86" y="89" width="12" height="32" rx="6" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />
      <circle cx="92" cy="124" r="5.5" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />

      {/* Left leg */}
      <rect x="27" y="133" width="18" height="11" rx="5.5" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />
      {/* Right leg */}
      <rect x="55" y="133" width="18" height="11" rx="5.5" fill="url(#bodyGrad)" stroke="#528ba3" strokeWidth="1" />
    </svg>
  )
}
