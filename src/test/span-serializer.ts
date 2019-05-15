import "jest";
import { MockSpanTree } from "./types";

const TAB = "   ";

function prefix(depth: number) {
  return TAB.repeat(depth) + `+-- `;
}

function logLine(log: any, index: number, depth: number) {
  return `${TAB.repeat(depth + 1)}${index}. ${JSON.stringify(log).replace(
    /\\"/g,
    ""
  )}`;
}

function logs(span: MockSpanTree, depth: number) {
  if (span.logs && span.logs.length > 0) {
    return `${TAB.repeat(depth + 1)}logs:\n${span.logs
      .map((log, index) => logLine(log, index + 1, depth))
      .join("\n")}\n`;
  }

  return "";
}

function tags(span: MockSpanTree, depth: number) {
  if (span.tags && span.tags.length > 0) {
    return `${TAB.repeat(depth + 1)}tags:\n${span.tags
      .map((tag, index) => logLine(tag, index + 1, depth))
      .join("\n")}\n`;
  }
  return "";
}

function tag(span: MockSpanTree, depth: number) {
  return `${span.name}:${span.id}\n${TAB.repeat(depth + 1)}finished: ${
    span.finished
  }\n${logs(span, depth)}\n${tags(span, depth)}`;
}

function buildSpan(span: MockSpanTree, depth = 0) {
  let result = "";

  result += tag(span, depth);

  if (span.children) {
    for (const child of span.children) {
      result += `${prefix(depth)}${buildSpan(child, depth + 1)}`;
    }
  }

  return result;
}

export default {
  test: (val: any) => val.id && val.name && val.logs && val.finished != null,
  print(
    val: any,
    _serialize: ((val: any) => string),
    _indent: ((str: string) => string),
    _opts: jest.SnapshotSerializerOptions,
    _colors: jest.SnapshotSerializerColors
  ) {
    return buildSpan(val as MockSpanTree);
  }
};
