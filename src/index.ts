import {
  ApolloServerPlugin,
  BaseContext,
  GraphQLFieldResolverParams,
  GraphQLRequestContext,
  GraphQLRequestListener,
  GraphQLRequestContextDidEncounterErrors,
  GraphQLRequestExecutionListener,
} from "@apollo/server";
import { GraphQLResolveInfo } from "graphql";
import { FORMAT_HTTP_HEADERS, Span, Tracer } from "opentracing";
import { addContextHelpers, SpanContext } from "./context";

export { SpanContext, addContextHelpers };

// used for sneakily attatching our SpanContext object to the application's GraphQL context object
const spanContextSymbol: unique symbol = Symbol.for(
  "apolloOpenTracingSpanContext"
);

/**
 * The interface for the application's context object
 */
export interface ContextForApolloOpenTracing extends BaseContext {
  // Initially empty - we will add this to the context object.
  [spanContextSymbol]?: SpanContext;
  // May be specified by users when creating their context object
  requestSpan?: Span;
}

/**
 * Our version of the application's context object (with the span context provided)
 */
export type WithRequiredSpanContext<T> = T & {
  [spanContextSymbol]: SpanContext;
};

/**
 * Does a GraphQL context object already contain a SpanContext property?
 */
export function hasSpanContext<Context extends object>(
  contextValue: Context
): contextValue is WithRequiredSpanContext<Context> {
  return spanContextSymbol in contextValue;
}

/**
 * Attaches a SpanContext property to a GraphQL context object.
 * (Has a side effect by mutating contextValue.)
 */
export function addSpanContext<Context extends ContextForApolloOpenTracing>(
  contextValue: Context,
  spanContext: SpanContext
): asserts contextValue is WithRequiredSpanContext<Context> {
  contextValue[spanContextSymbol] = spanContext;
}

const alwaysTrue = () => true;
const emptyFunction = () => {};

export interface InitOptions<TContext extends BaseContext> {
  server?: Tracer;
  local?: Tracer;
  onFieldResolveFinish?: (error: Error | null, result: any, span: Span) => void;
  onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => void;
  shouldTraceRequest?: (info: GraphQLRequestContext<TContext>) => boolean;
  shouldTraceFieldResolver?: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => boolean;
  onRequestResolve?: (
    span: Span,
    info: GraphQLRequestContext<TContext>
  ) => void;
  createCustomSpanName?: (name: string, info: GraphQLResolveInfo) => string;
  onRequestError?: (
    rootSpan: Span,
    info: GraphQLRequestContextDidEncounterErrors<TContext>
  ) => void;
}

function getFieldName(info: GraphQLResolveInfo) {
  if (
    info.fieldNodes &&
    info.fieldNodes.length > 0 &&
    info.fieldNodes[0].alias
  ) {
    return info.fieldNodes[0].alias.value;
  }

  return info.fieldName || "field";
}

function headersToOject(
  headerIterator: Iterator<[string, string], any, undefined> | undefined
): Record<string, string> {
  if (!headerIterator) {
    return {};
  }

  const headers: Record<string, string> = {};
  let header:
    | IteratorYieldResult<[string, string]>
    | IteratorReturnResult<any>
    | undefined;
  do {
    header = headerIterator?.next();
    if (header?.value) {
      const [key, value] = header?.value;
      headers[key] = value;
    }
  } while (!header?.done);

  return headers;
}

export default function OpentracingPlugin<InstanceContext extends ContextForApolloOpenTracing>({
  server,
  local,
  onFieldResolveFinish = emptyFunction,
  onFieldResolve = emptyFunction,
  shouldTraceRequest = alwaysTrue,
  shouldTraceFieldResolver = alwaysTrue,
  onRequestResolve = emptyFunction,
  onRequestError = emptyFunction,
  createCustomSpanName = (name, _) => name,
}: InitOptions<InstanceContext>): ApolloServerPlugin<InstanceContext> {
  if (!server) {
    throw new Error(
      "ApolloOpentracing needs a server tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"
    );
  }

  if (!local) {
    throw new Error(
      "ApolloOpentracing needs a local tracer, please provide it to the constructor. e.g. new ApolloOpentracing({ server: serverTracer, local: localTracer })"
    );
  }
  const serverTracer = server;
  const localTracer = local;

  let requestSpan: Span | null = null;
  return {
    async requestDidStart(
      infos: GraphQLRequestContext<InstanceContext>
    ): Promise<GraphQLRequestListener<InstanceContext> | void> {
      addContextHelpers(infos.contextValue);
      if (!shouldTraceRequest(infos)) {
        return;
      }

      const headers = headersToOject(infos.request.http?.headers.entries());

      const externalSpan = headers
        ? serverTracer.extract(FORMAT_HTTP_HEADERS, headers)
        : undefined;

      const rootSpan =
        infos.contextValue.requestSpan ||
        serverTracer.startSpan(infos.operationName || "request", {
          childOf: externalSpan ? externalSpan : undefined,
        });

      onRequestResolve(rootSpan, infos);
      requestSpan = rootSpan;

      return {
        async willSendResponse() {
          rootSpan.finish();
        },

        async executionDidStart(): Promise<
          GraphQLRequestExecutionListener<InstanceContext>
        > {
          return {
            willResolveField({
              source,
              args,
              contextValue,
              info,
            }: GraphQLFieldResolverParams<any, InstanceContext>) {
              if (!hasSpanContext(contextValue)) {
                console.warn(
                  "Context in request passed to apollo-opentracing#willResolveField is not a SpanContext, aborting tracing"
                );
                return;
              }

              if (
                // we don't trace the request
                !requestSpan ||
                // we should not trace this resolver
                !shouldTraceFieldResolver(source, args, contextValue, info) ||
                // the previous resolver was not traced
                (info.path &&
                  info.path.prev &&
                  !contextValue[spanContextSymbol].getSpanByPath(info.path.prev))
              ) {
                return;
              }

              // idempotent method to add helpers to the first contextValue available (which will be propagated by apollo)
              addContextHelpers(contextValue);

              const name = createCustomSpanName(getFieldName(info), info);
              const parentSpan =
                info.path && info.path.prev
                  ? contextValue[spanContextSymbol].getSpanByPath(info.path.prev)
                  : requestSpan;

              const span = localTracer.startSpan(name, {
                childOf: parentSpan || undefined,
              });

              contextValue[spanContextSymbol].addSpan(span, info);
              // expose to field (although type does not contain it)
              (info as any).span = span;

              onFieldResolve(source, args, contextValue, info);

              return (error: Error | null, result: any) => {
                onFieldResolveFinish(error, result, span);

                span.finish();
              };
            },
          };
        },

        didEncounterErrors: async (requestContext) => {
          onRequestError(rootSpan, requestContext);
        },
      };
    },
  };
}
