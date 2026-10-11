import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { onDaemonPush } from '@/api/client';
import { taskKeys } from '@/api/tasks';
import { router } from '@/router';
import './index.css';

function LiveTasks() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onDaemonPush((method) => {
        if (method !== 'event') return;
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      }),
    [queryClient],
  );
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveTasks />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
