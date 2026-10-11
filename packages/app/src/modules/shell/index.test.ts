import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { connectionKeys } from '@/api/connections';
import { taskKeys } from '@/api/tasks';

async function settled(observer: {
  getCurrentResult: () => { fetchStatus: string; status: string };
}): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = observer.getCurrentResult();
    if (result.fetchStatus === 'idle' && result.status !== 'pending') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('query did not settle');
}

describe('侧栏查询', () => {
  it('同一个 key 上同时存在的观察者只请求一次', async () => {
    let calls = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = async () => {
      calls += 1;
      return ['空列表崩了'];
    };
    const first = new QueryObserver(client, { queryKey: taskKeys.list, queryFn });
    const second = new QueryObserver(client, { queryKey: taskKeys.list, queryFn });
    const stopFirst = first.subscribe(() => undefined);
    const stopSecond = second.subscribe(() => undefined);
    await settled(first);
    expect(calls).toBe(1);
    expect(second.getCurrentResult().data).toEqual(['空列表崩了']);
    expect(client.getQueryCache().findAll({ queryKey: taskKeys.list })).toHaveLength(1);
    stopFirst();
    stopSecond();
    client.clear();
  });

  it('观察者卸掉再挂上会再请求，所以换页不能拆掉侧栏', async () => {
    let listCalls = 0;
    let doctorCalls = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = new QueryObserver(client, {
      queryKey: taskKeys.list,
      queryFn: async () => {
        listCalls += 1;
        return [];
      },
    });
    const doctor = new QueryObserver(client, {
      queryKey: connectionKeys.doctor,
      queryFn: async () => {
        doctorCalls += 1;
        return { tools: [] };
      },
    });
    const stopList = list.subscribe(() => undefined);
    const stopDoctor = doctor.subscribe(() => undefined);
    await settled(list);
    await settled(doctor);
    expect(listCalls).toBe(1);
    expect(doctorCalls).toBe(1);
    stopList();
    stopDoctor();
    const again = new QueryObserver(client, {
      queryKey: taskKeys.list,
      queryFn: async () => {
        listCalls += 1;
        return [];
      },
    });
    const stopAgain = again.subscribe(() => undefined);
    for (let attempt = 0; attempt < 50 && listCalls < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(listCalls).toBe(2);
    stopAgain();
    client.clear();
  });
});
