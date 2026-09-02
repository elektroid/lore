import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import App from './App'
import { toast } from '@/stores/toast'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
  // Fallback for the many mutations that don't define their own onError: a
  // failed write used to fail completely silently (no toast library existed
  // at all). A mutation-level onError still runs in addition to this one, so
  // pages doing their own inline error display are unaffected.
  mutationCache: new MutationCache({
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Une erreur est survenue'),
  }),
})

// createBrowserRouter (data router) is required for useBlocker to work.
// A single wildcard route lets App.tsx keep its existing <Routes> tree.
const router = createBrowserRouter([
  {
    path: '/*',
    element: (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
