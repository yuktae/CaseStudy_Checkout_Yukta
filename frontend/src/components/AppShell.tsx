import { Outlet } from 'react-router-dom'
import { ProcessingDock } from './ProcessingDock'

export function AppShell() {
  return (
    <div className="h-full">
      <main className="h-full">
        <Outlet />
      </main>
      <ProcessingDock />
    </div>
  )
}
