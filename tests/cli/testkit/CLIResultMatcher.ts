import stripAnsi from "strip-ansi";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CLIResultMatcher {
  constructor(private result: CLIResult) {}

  toSucceed(): void {
    if (this.result.exitCode !== 0) {
      throw new Error(
        `Expected command to succeed but got exit code ${this.result.exitCode}\n` +
          `stderr: ${stripAnsi(this.result.stderr)}`
      );
    }
  }

  toFail(): void {
    if (this.result.exitCode === 0) {
      throw new Error("Expected command to fail but it succeeded");
    }
  }

  toHaveExitCode(code: number): void {
    if (this.result.exitCode !== code) {
      throw new Error(
        `Expected exit code ${code} but got ${this.result.exitCode}`
      );
    }
  }

  toContain(text: string): void {
    const output = this.result.stdout + this.result.stderr;
    if (!output.includes(text)) {
      throw new Error(
        `Expected output to contain "${text}"\n` +
          `stdout: ${stripAnsi(this.result.stdout)}\n` +
          `stderr: ${stripAnsi(this.result.stderr)}`
      );
    }
  }

  toContainInStdout(text: string): void {
    if (!this.result.stdout.includes(text)) {
      throw new Error(
        `Expected stdout to contain "${text}"\n` +
          `stdout: ${stripAnsi(this.result.stdout)}`
      );
    }
  }

  toContainInStderr(text: string): void {
    if (!this.result.stderr.includes(text)) {
      throw new Error(
        `Expected stderr to contain "${text}"\n` +
          `stderr: ${stripAnsi(this.result.stderr)}`
      );
    }
  }
}
