import React from 'react'

interface NuvhoLogoProps {
  variant?:  'primary' | 'white'
  height?:   number
  width?:    number
  className?: string
}

/**
 * Nuvho full wordmark logo.
 * Uses the official brand SVG assets from /public/.
 * variant='white'   → use on dark surfaces (sidebar, dark headers, footers)
 * variant='primary' → use on light surfaces
 *
 * Size control (mutually exclusive — pick one):
 *   height={n}  → fixed height, width auto  (default: height=40)
 *   width={n}   → fixed width,  height auto
 */
export function NuvhoLogo({ variant = 'primary', height, width, className = '' }: NuvhoLogoProps) {
  const src = variant === 'white' ? '/logo-white.svg' : '/logo-primary.svg'

  const style: React.CSSProperties = width
    ? { width, height: 'auto', display: 'block' }
    : { height: height ?? 40, width: 'auto', display: 'block' }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Nuvho"
      width={width}
      height={width ? undefined : (height ?? 40)}
      style={style}
      className={className}
    />
  )
}

interface NuvhoIconMarkProps {
  variant?:  'primary' | 'white'
  size?:     number
  className?: string
}

/**
 * Nuvho icon mark (symbol only, no wordmark).
 * variant='white'   → use on dark surfaces
 * variant='primary' → use on light surfaces
 */
export function NuvhoIconMark({ variant = 'primary', size = 40, className = '' }: NuvhoIconMarkProps) {
  const src = variant === 'white' ? '/icon-white.svg' : '/icon-primary.svg'

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Nuvho"
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block' }}
      className={className}
    />
  )
}
