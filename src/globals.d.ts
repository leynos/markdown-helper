/**
 * @file Browser-global type declarations shared by the extension scripts.
 */

type MarkdownEdit = {
  start: number;
  end: number;
  text: string;
};

type MarkdownResult = {
  edits: MarkdownEdit[];
  selection: { start: number; end: number };
};

type MarkdownCommand =
  | 'quote'
  | 'bold'
  | 'italic'
  | 'code-span'
  | 'code-block'
  | 'footnote';

type MarkdownRequest = {
  command: MarkdownCommand;
  readonly value: string;
  readonly start: number;
  readonly end: number;
};

declare const MDHelper: {
  apply(request: MarkdownRequest): MarkdownResult | null;
};

/** Synchronous, context-local telemetry shared by browser scripts. */
declare const MDTelemetry: {
  start(
    stage: string,
    operationId: unknown,
  ): {
    end(outcome: string, reason?: string): void;
  };
  snapshot(): {
    labels: string;
    count: number;
    durationMs: number;
    buckets: number[];
  }[];
};
