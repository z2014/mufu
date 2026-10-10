import { useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '页面出错了';
  return (
    <main className="bg-background flex h-dvh flex-col items-center justify-center gap-3 p-8">
      <p className="bg-primary text-primary-foreground inline-flex size-8 items-center justify-center rounded-full text-sm font-bold">
        !
      </p>
      <h1 className="text-base font-semibold">页面出错了</h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">{message}</p>
      <a className="text-sm underline" href="#/">
        回到看板
      </a>
    </main>
  );
}
