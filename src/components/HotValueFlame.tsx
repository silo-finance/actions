'use client'

import { useId } from 'react'

type HotValueFlameProps = {
  title?: string
}

export default function HotValueFlame({
  title = 'High-value position (top 1%, at least 10× the rest)',
}: HotValueFlameProps) {
  const uid = useId().replace(/:/g, '')
  const outerGradientId = `hot-flame-outer-${uid}`
  const innerGradientId = `hot-flame-inner-${uid}`

  return (
    <span className="hot-value-flame shrink-0" role="img" aria-label={title} title={title}>
      <span className="hot-value-flame__frame">
        <svg
          className="hot-value-flame__svg"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            className="hot-value-flame__outer"
            d="M13.5 4.938a7 7 0 1 1-9.006 1.737c.202-.257.59-.218.793.039.278.352.594.672.943.954.332.269.786-.049.773-.476a5.977 5.977 0 0 1 .572-2.759 6.026 6.026 0 0 1 2.486-2.665c.247-.14.55-.016.677.238A6.967 6.967 0 0 0 13.5 4.938Z"
            fill={`url(#${outerGradientId})`}
          />
          <path
            className="hot-value-flame__inner"
            d="M14 12a4 4 0 0 1-4 4c-1.913 0-3.52-1.398-3.91-3.182-.093-.429.44-.643.814-.413a4.043 4.043 0 0 0 1.601.564c.303.038.531-.24.51-.544a5.975 5.975 0 0 1 1.315-4.192.447.447 0 0 1 .431-.16A4.001 4.001 0 0 1 14 12Z"
            fill={`url(#${innerGradientId})`}
          />
          <defs>
            <linearGradient id={outerGradientId} x1="10" y1="2" x2="10" y2="18" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fbbf24" />
              <stop offset="0.55" stopColor="#f97316" />
              <stop offset="1" stopColor="#dc2626" />
            </linearGradient>
            <linearGradient id={innerGradientId} x1="10" y1="8" x2="10" y2="16" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fef9c3" />
              <stop offset="1" stopColor="#fb923c" />
            </linearGradient>
          </defs>
        </svg>
      </span>
    </span>
  )
}
