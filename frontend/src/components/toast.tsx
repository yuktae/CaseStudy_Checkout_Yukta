import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

const ToastContext = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-[var(--shadow-pop)]"
            >
              {t.tone === 'ok' ? (
                <CircleCheck className="size-4 shrink-0 text-[#6ee7a0]" />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-[#fca5a5]" />
              )}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
