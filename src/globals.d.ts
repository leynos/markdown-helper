type MarkdownEdit = {
  start: number;
  end: number;
  text: string;
};

type MarkdownResult = {
  edits: MarkdownEdit[];
  selection: { start: number; end: number };
};

declare const MDHelper: {
  apply(
    command: string,
    value: string,
    start: number,
    end: number,
  ): MarkdownResult | null;
};
