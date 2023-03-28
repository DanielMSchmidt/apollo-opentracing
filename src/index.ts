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
import {
  addContextHelpers,
  SpanContext,
  requestIsInstanceContextRequest,
} from "./context";

export { SpanContext, addContextHelpers };

const alwaysTrue = () => true;
const emptyFunction = () => {};

export interface InitOptions<TContext extends BaseContext> {
  server?: Tracer;
  local?: Tracer;
  onFieldResolveFinish?: (error: Error | null, result: any, span: Span) => void;
  onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => void;
  shouldTraceRequest?: (info: GraphQLRequestContext<TContext>) => boolean;
  shouldTraceFieldResolver?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
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

export default function OpentracingPlugin<InstanceContext extends SpanContext>({
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
      if (!requestIsInstanceContextRequest<InstanceContext>(infos)) {
        console.warn(
          "Context in request passed to apollo-opentracing#requestDidStart is not a SpanContext, aborting tracing"
        );
        return;
      }
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
              if (
                // we don't trace the request
                !requestSpan ||
                // we should not trace this resolver
                !shouldTraceFieldResolver(source, args, contextValue, info) ||
                // the previous resolver was not traced
                (info.path &&
                  info.path.prev &&
                  !contextValue.getSpanByPath(info.path.prev))
              ) {
                return;
              }

              // idempotent method to add helpers to the first contextValue available (which will be propagated by apollo)
              addContextHelpers(contextValue);

              const name = createCustomSpanName(getFieldName(info), info);
              const parentSpan =
                info.path && info.path.prev
                  ? contextValue.getSpanByPath(info.path.prev)
                  : requestSpan;

              const span = localTracer.startSpan(name, {
                childOf: parentSpan || undefined,
              });

              contextValue.addSpan(span, info);
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
