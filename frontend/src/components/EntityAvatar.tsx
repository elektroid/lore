import { useState } from 'react'

const PALETTE = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
]

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(w => w[0].toUpperCase())
    .join('')
}

function hashColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length]
}

interface Props {
  name: string
  imageUrl?: string
  onImageClick?: () => void
}

export default function EntityAvatar({ name, imageUrl, onImageClick }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 rounded object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={onImageClick}
        onError={() => setFailedUrl(imageUrl)}
      />
    )
  }

  const initials = getInitials(name)
  const bg = name ? hashColor(name) : 'bg-muted'

  return (
    <div className={`h-10 w-10 rounded shrink-0 flex items-center justify-center ${bg}`}>
      {initials
        ? <span className="text-[10px] font-bold text-white leading-none select-none">{initials}</span>
        : <span className="text-[10px] text-white/40 select-none">?</span>
      }
    </div>
  )
}
