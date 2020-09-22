import { Request } from "apollo-server-env";
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLRequestContext } from "apollo-server-types";
import { DocumentNode, GraphQLResolveInfo } from "graphql";
import { FORMAT_HTTP_HEADERS, Span, Tracer } from "opentracing";
import { addContextHelpers, makeContextHelper, SpanContext } from "./context";

export { SpanContext, addContextHelpers };

const alwaysTrue = () => true;
const emptyFunction = () => {};

export interface InitOptions<TContext> {
  server?: Tracer;
  local?: Tracer;
  onFieldResolveFinish?: (error: Error | null, result: any, span: Span) => void;
  onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => void;
  shouldTraceRequest?: (requestContext: GraphQLRequestContext<TContext>) => boolean;
  shouldTraceFieldResolver?: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => boolean;
  onRequestResolve?: (span: Span, requestContext: GraphQLRequestContext<TContext>) => void;
}

export interface ExtendedGraphQLResolveInfo extends GraphQLResolveInfo {
  span?: Span;
}
export interface RequestStart<TContext> {
  request: Pick<Request, "url" | "method" | "headers">;
  queryString?: string;
  parsedQuery?: DocumentNode;
  operationName?: string;
  variables?: { [key: string]: any };
  persistedQueryHit?: boolean;
  persistedQueryRegister?: boolean;
  context: TContext;
  requestContext: GraphQLRequestContext<TContext>;
}

function getFieldName(info: GraphQLResolveInfo) {
  if (info.fieldNodes && info.fieldNodes.length > 0 && info.fieldNodes[0].alias) {
    return info.fieldNodes[0].alias.value;
  }

  return info.fieldName || "field";
}

export default class ApolloTracingPlugin<TContext extends Record<string, unknown>> {
  private serverTracer: Tracer;
  private localTracer: Tracer;
  private requestSpan: Span | null;
  private onFieldResolveFinish?: (error: Error | null, result: any, span: Span) => void;
  private onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => void;
  private shouldTraceRequest: (requestContext: GraphQLRequestContext<TContext>) => boolean;
  private shouldTraceFieldResolver: (
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) => boolean;
  private onRequestResolve: (span: Span, requestContext: GraphQLRequestContext<TContext>) => void;
  private requests: WeakMap<TContext, SpanContext> = new WeakMap<TContext, SpanContext>();

  constructor({
    server,
    local,
    shouldTraceRequest,
    shouldTraceFieldResolver,
    onFieldResolveFinish,
    onFieldResolve,
    onRequestResolve,
  }: InitOptions<TContext> = {}) {
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

    this.serverTracer = server;
    this.localTracer = local;
    this.requestSpan = null;
    this.shouldTraceRequest = shouldTraceRequest || alwaysTrue;
    this.shouldTraceFieldResolver = shouldTraceFieldResolver || alwaysTrue;
    this.onFieldResolveFinish = onFieldResolveFinish;
    this.onFieldResolve = onFieldResolve;
    this.onRequestResolve = onRequestResolve || emptyFunction;
  }

  mapToObj(inputMap: Map<string, any>) {
    const obj: { [key: string]: string } = {};

    inputMap.forEach(function (value, key) {
      obj[key] = value;
    });

    return obj;
  }

  getPlugin() {
    return {
      requestDidStart: this.requestDidStart.bind(this),
    };
  }

  requestDidStart(requestContext: GraphQLRequestContext<TContext>) {
    if (!this.shouldTraceRequest(requestContext)) {
      return;
    }

    this.requests.set(requestContext.context, makeContextHelper());

    let headers;
    const tmpHeaders =
      requestContext.request &&
      requestContext.request.http &&
      ((requestContext.request.http.headers as unknown) as Map<string, any>);
    if (tmpHeaders && typeof tmpHeaders.get === "function") {
      headers = this.mapToObj(tmpHeaders);
    } else {
      headers = tmpHeaders;
    }

    const externalSpan =
      requestContext.request && requestContext.request.http && requestContext.request.http.headers
        ? this.serverTracer.extract(FORMAT_HTTP_HEADERS, headers)
        : undefined;

    const requestHelper = this.requests.get(requestContext.context)!;

    const rootSpan =
      requestHelper.requestSpan ||
      this.serverTracer.startSpan(requestContext.operationName || "request", {
        childOf: externalSpan ? externalSpan : undefined,
      });

    this.onRequestResolve(rootSpan, requestContext);
    this.requestSpan = rootSpan;

    return {
      executionDidStart: () => ({
        willResolveField: this.willResolveField.bind(this),
      }),
      willSendResponse: this.willSendResponse.bind(this),
    };
  }

  willResolveField({
    source,
    args,
    context,
    info,
  }: {
    source: any;
    args: { [argName: string]: any };
    context: TContext;
    info: ExtendedGraphQLResolveInfo;
  }) {
    const requestHelper = this.requests.get(context)!;

    if (
      // we don't trace the request
      !this.requestSpan ||
      // we should not trace this resolver
      !this.shouldTraceFieldResolver(source, args, context, info) ||
      // the previous resolver was not traced
      (info.path && info.path.prev && !requestHelper.getSpanByPath(info.path.prev))
    ) {
      return;
    }

    const name = getFieldName(info);
    const parentSpan =
      info.path && info.path.prev ? requestHelper.getSpanByPath(info.path.prev) : this.requestSpan;

    const span = this.localTracer.startSpan(name, {
      childOf: parentSpan || undefined,
    });

    requestHelper.addSpan(span, info);
    // expose to field
    info.span = span;

    if (this.onFieldResolve) {
      this.onFieldResolve(source, args, context, info);
    }

    return (error: Error | null, result: any) => {
      if (this.onFieldResolveFinish) {
        this.onFieldResolveFinish(error, result, span);
      }
      span.finish();
    };
  }

  willSendResponse() {
    if (this.requestSpan) {
      this.requestSpan.finish();
    }
  }
}
