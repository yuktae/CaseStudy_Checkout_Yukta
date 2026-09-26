import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './pages/dashboard/Dashboard'

// The analysis page carries the PDF engine; load it only when a case is opened.
const AnalysisPage = lazy(() => import('./pages/analysis/AnalysisPage').then((m) => ({ default: m.AnalysisPage })))

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Dashboard /> },
      {
        path: '/cases/:id',
        element: (
          <Suspense fallback={null}>
            <AnalysisPage />
          </Suspense>
        ),
      },
    ],
  },
])
