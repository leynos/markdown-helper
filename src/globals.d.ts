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
