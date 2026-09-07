import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Renders a share URL as a QR code, generated client-side (no third-party
 * QR API — the link stays local, same reasoning as never sending user data
 * to an unrelated service). SVG so it stays crisp at any size, including a
 * phone camera held at a distance from a projected screen.
 */
export default function DoodleQRCode({ value, size = 112, className = '' }: {
  value: string
  size?: number
  className?: string
}) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { type: 'svg', margin: 1, width: size }).then(s => {
      if (!cancelled) setSvg(s)
    })
    return () => { cancelled = true }
  }, [value, size])

  if (!svg) {
    return <div style={{ width: size, height: size }} className={`bg-muted rounded animate-pulse ${className}`} />
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`[&_svg]:h-full [&_svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
