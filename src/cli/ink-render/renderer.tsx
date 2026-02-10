import EventEmitter from "node:events";
import { type Instance as InkInstance, render as inkRender } from "ink";
import type { FC, ReactElement, ReactNode } from "react";
import { Component } from "react";
import stripAnsi from "strip-ansi";
import { type ExitFn, useExit } from "./hooks/use-exit.js";

class ErrorBoundary extends Component<
  { children: ReactNode; onExit: ExitFn },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError(_error: unknown) {
    return { hasError: true };
  }

  override componentDidCatch(e: unknown) {
    const error = e instanceof Error ? e : new Error(JSON.stringify(e));

    this.props.onExit(error);
  }

  override render() {
    return this.state.hasError ? null : this.props.children;
  }
}

const ErrorBoundaryWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const exit = useExit();

  return <ErrorBoundary onExit={exit}>{children}</ErrorBoundary>;
};

export async function render(tree: ReactElement): Promise<void> {
  const { waitUntilExit, unmount } = inkRender(
    <ErrorBoundaryWrapper>{tree}</ErrorBoundaryWrapper>,
    { exitOnCtrlC: true }
  );

  // If we don't unmount, the app render promise (which returns from
  // `waitUntilExit`) will never resolve, and any code after rendering will not
  // be executed (most commonly sending a "command success" BI event). The
  // process will still exit because node doesn't wait for pending promises, so
  // the end result is the process will exit without running any code that
  // happens after the render call.
  process.once("beforeExit", () => {
    unmount();
  });

  /**
   * ink handles ctrl+c and unmounts the app only if it listens to input (by a
   * component using `useInput`). Otherwise it doesn't handle it, meaning it's
   * being handled by node, which exits the process. When that happens, we don't
   * get to any code that waits for the rendering to finish (usually command end
   * BI event). This is an unpredictable behavior, because it depends on whether
   * some component listens to input or not. Therefore, we listen on SIGINT
   * (which is fired when ctrl+c is pressed) and unmount
   */
  process.once("SIGINT", () => {
    unmount();
  });

  await waitUntilExit();
}

class FakeStream extends EventEmitter {
  readonly columns = 500;
  private _lastFrame?: string;
  private stripAnsi: boolean;

  constructor({ stripAnsi }: { stripAnsi: boolean }) {
    super();
    this.stripAnsi = stripAnsi;
  }

  write(frame: string) {
    this._lastFrame = this.stripAnsi ? stripAnsi(frame) : frame;
  }

  lastFrame = () => this._lastFrame ?? "";
}

export function createRendererToString({ stripAnsi }: { stripAnsi: boolean }) {
  let instance: InkInstance | undefined;
  const stdout = new FakeStream({ stripAnsi });

  return {
    waitUntilExit: async () => {
      return instance?.waitUntilExit();
    },
    render: (tree: ReactElement) => {
      const wrappedTree = <ErrorBoundaryWrapper>{tree}</ErrorBoundaryWrapper>;

      if (instance) {
        instance.rerender(wrappedTree);
      } else {
        instance = inkRender(wrappedTree, {
          stdout: stdout as never,
          debug: true,
          exitOnCtrlC: false,
          patchConsole: false,
        });
      }

      return stdout.lastFrame();
    },
    unmount: () => {
      instance?.unmount();
      instance?.cleanup();
    },
  };
}
