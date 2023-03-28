import { Span } from "opentracing";
import { GraphQLResolveInfo, ResponsePath } from "graphql";
import { ContextForApolloOpenTracing, WithRequiredSpanContext, hasSpanContext, addSpanContext } from './index';

/**
 * Object containing private methods that this library uses, that will be attatched to the GQL context object.
 * (Will be namespaced using a symbol to hide this from users)
 */
export interface SpanContext {
  getSpanByPath(info: ResponsePath): Span | undefined;
  addSpan(span: Span, info: GraphQLResolveInfo): void;
}

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

export function addContextHelpers<Context extends ContextForApolloOpenTracing>(
  contextValue: Context
): WithRequiredSpanContext<Context> {
  if (hasSpanContext(contextValue)) {
    return contextValue;
  }

  const spans = new Map<string, Span>();
  const spanContext: SpanContext = {
    getSpanByPath: (path: ResponsePath): Span | undefined => {
      return spans.get(buildPath(isArrayPath(path) ? path.prev : path));
    },
    addSpan: (span: Span, info: GraphQLResolveInfo): void => {
      spans.set(buildPath(info.path), span);
    },
  };

  addSpanContext(contextValue, spanContext);
  return contextValue;
}
