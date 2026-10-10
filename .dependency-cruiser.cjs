/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'schema-is-leaf',
      comment: 'schema 不依赖任何业务包',
      severity: 'error',
      from: { path: '^packages/schema' },
      to: { path: '^packages/(core|adapters|daemon|cli|app)' },
    },
    {
      name: 'core-not-outward',
      comment: '核心不依赖适配器、守护进程、命令行或界面',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: '^packages/(adapters|daemon|cli|app)' },
    },
    {
      name: 'adapters-not-up',
      comment: '适配器不依赖守护进程、命令行或界面',
      severity: 'error',
      from: { path: '^packages/adapters' },
      to: { path: '^packages/(daemon|cli|app)' },
    },
    {
      name: 'cli-not-adapters',
      comment: '命令行只通过 socket 找守护进程，不碰适配器',
      severity: 'error',
      from: { path: '^packages/cli' },
      to: { path: '^packages/adapters' },
    },
    {
      name: 'app-not-backend',
      comment: '界面只通过守护进程客户端，不依赖守护进程或适配器实现',
      severity: 'error',
      from: { path: '^packages/app' },
      to: { path: '^packages/(adapters|daemon|cli)' },
    },
    {
      name: 'no-circular',
      comment: '包之间不形成环',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
  },
};
