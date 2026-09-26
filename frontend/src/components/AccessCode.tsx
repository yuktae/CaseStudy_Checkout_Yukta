import { KeyRound } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ApiError, setAccessCode } from '../lib/api'
import { Modal } from './Modal'
import { useToast } from './toast'
import { Button } from './ui'

/** Runs an API action; if the server asks for the demo access code, prompts for it and retries. */
export function useWithCode() {
  const toast = useToast()
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null)
  const [code, setCode] = useState('')

  const withCode = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) setPending(() => fn)
        else toast((e as Error).message, 'error')
      }
    },
    [toast],
  )

  const submit = async () => {
    setAccessCode(code)
    const fn = pending
    setPending(null)
    if (fn) await withCode(fn)
  }

  const dialog = (
    <Modal
      open={!!pending}
      onClose={() => setPending(null)}
      title="Access code required"
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button variant="dark" onClick={submit} disabled={!code}>
            Continue
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code) submit()
        }}
        className="flex flex-col gap-2 text-[13px] text-text-2"
      >
        <span className="flex items-center gap-2">
          <KeyRound className="size-4" /> Uploads and analysis on this demo need the access code.
        </span>
        <input autoFocus type="password" value={code} onChange={(e) => setCode(e.target.value)} className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-blue" />
      </form>
    </Modal>
  )

  return { withCode, dialog }
}
