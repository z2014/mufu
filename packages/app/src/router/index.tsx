import { createHashRouter } from 'react-router';

import { RouteError } from '@/common/components/route-error';

export const router = createHashRouter([
  {
    path: '/',
    lazy: () => import('@/modules/board'),
    errorElement: <RouteError />,
  },
  {
    path: '/task/:taskId',
    lazy: () => import('@/modules/task'),
    errorElement: <RouteError />,
  },
  {
    path: '/settings',
    lazy: () => import('@/modules/settings'),
    errorElement: <RouteError />,
  },
]);
