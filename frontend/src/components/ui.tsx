import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Variant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue text-white hover:bg-blue-dark shadow-sm',
  dark: 'bg-ink text-white hover:bg-ink-2 shadow-sm',
  secondary: 'bg-surface text-text border border-line hover:border-[#cfd6e4] hover:bg-[#fafbfd]',
  ghost: 'text-text-2 hover:bg-line-2 hover:text-text',
  danger: 'bg-surface text-bad border border-line hover:bg-bad-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue active:scale-[0.98]',
        'disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip text={label}>
      <button
        aria-label={label}
        {...rest}
        className={clsx(
          'inline-flex size-9 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-line-2 hover:text-text',
          'focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-40 disabled:pointer-events-none',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={clsx('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)}>
      {children}
    </section>
  )
}

export function SectionTitle({ index, children, right }: { index?: number; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold text-text">
        {index !== undefined && (
          <span className="flex size-6 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">{index}</span>
        )}
        {children}
      </h2>
      {right}
    </div>
  )
}

/** Tooltip rendered in a portal with fixed positioning, so it is never clipped and never affects layout. */
export function Tooltip({ text, children, side = 'top', className }: { text?: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  if (!text) return <>{children}</>
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150)
    setPos({ x, y: side === 'top' ? r.top - 8 : r.bottom + 8 })
  }
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} className={clsx('inline-flex', className)}>
      {children}
      {pos &&
        createPortal(
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: side === 'top' ? 3 : -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12, delay: 0.08 }}
            className={clsx(
              'pointer-events-none fixed z-[100] w-max max-w-72 -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug font-normal text-white shadow-lg',
              side === 'top' && '-translate-y-full',
            )}
            style={{ left: pos.x, top: pos.y }}
          >
            {text}
          </motion.span>,
          document.body,
        )}
    </span>
  )
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-text-2', className)}>
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-line-2', className)} />
}
