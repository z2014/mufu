import type { TaskView } from '@mufu/core/view';

/** 布局路由交给子页面的只读快照。子页面不再自己订阅侧栏用的列表。 */
export type WorkbenchContext<TDoctor = unknown> = {
  tasks: TaskView[] | undefined;
  tasksPending: boolean;
  tasksError: unknown;
  openNewTask: () => void;
  doctor: TDoctor | undefined;
  doctorPending: boolean;
  doctorFetching: boolean;
  doctorError: unknown;
  recheckDoctor: () => void;
};
