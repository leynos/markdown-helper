MDHelper.apply({ command: 'bold', value: 'text', start: 0, end: 4 });

const request: MarkdownRequest = {
  command: 'code-span',
  value: 'text',
  start: 0,
  end: 4,
};
MDHelper.apply(request);

// @ts-expect-error Markdown commands are a closed union.
MDHelper.apply({ command: 'underline', value: 'text', start: 0, end: 4 });

// @ts-expect-error Selection coordinates are immutable.
request.start = 1;

// @ts-expect-error Source values are immutable.
request.value = 'other';
