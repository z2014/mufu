import { useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '页面出错了';
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-background p-8">
      <p className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        !
      </p>
      <h1 className="text-base font-semibold">页面出错了</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">{message}</p>
      <a className="text-sm underline" href="#/">
        回到看板
      </a>
    </main>
  );
}
