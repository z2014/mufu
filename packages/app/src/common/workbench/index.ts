/** 布局路由只把界面动作交给子页面。任务和连接状态由各页自己的查询钩子读取。 */
export type WorkbenchContext = {
  openNewTask: () => void;
};
