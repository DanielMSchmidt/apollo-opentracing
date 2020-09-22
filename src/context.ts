import { Span } from "opentracing";
import { GraphQLResolveInfo, ResponsePath } from "graphql";

function isArrayPath(path: ResponsePath) {
  return typeof path.key === "number";
}

export function buildPath(path: ResponsePath | undefined) {
  let current = path;
  const segments = [];
  while (current != null) {
    if (isArrayPath(current)) {
      segments.push(`[${current.key}]`);
    } else {
      segments.push(current.key);
    }
    current = current.prev;
  }
  return segments.reverse().join(".");
}

export class SpanContext {
  _spans = new Map<string, Span>();
  getSpanByPath(path: ResponsePath): Span | undefined {
    return this._spans.get(buildPath(isArrayPath(path) ? path.prev : path));
  };
  addSpan(span: Span, info: GraphQLResolveInfo): void {
    this._spans.set(buildPath(info.path), span);
  };
  // Passed in from the outside context
  requestSpan?: Span;
}

function isSpanContext(obj: any): obj is SpanContext {
  return (
    obj.getSpanByPath instanceof Function && obj.addSpan instanceof Function
  );
}

// TODO: think about using symbols to hide these
export function addContextHelpers(obj: any): SpanContext {
  if (isSpanContext(obj)) {
    return obj;
  }

  obj._spans = new Map<string, Span>();
  obj.getSpanByPath = function (path: ResponsePath): Span | undefined {
    return this._spans.get(buildPath(isArrayPath(path) ? path.prev : path));
  };

  obj.addSpan = function (span: Span, info: GraphQLResolveInfo): void {
    this._spans.set(buildPath(info.path), span);
  };

  return obj;
}

export function makeContextHelper() {
  return new SpanContext();
}
