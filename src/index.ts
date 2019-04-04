import * as opentracing from "opentracing";
import { GraphQLResolveInfo, DocumentNode } from "graphql";
import { GraphQLExtension } from "graphql-extensions";
import { Tracer, Span } from "opentracing";
import { Request } from "apollo-server-env";
import { SpanContext, addContextHelpers } from "./context";

const alwaysTrue = () => true;

interface InitOptions {
  server?: Tracer;
  local?: Tracer;
  onFieldResolveFinish?: (error: Error | null, result: any, span: Span) => void;
  onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => void;
  shouldTraceRequest?: (info: RequestStart) => boolean;
  shouldTraceFieldResolver?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => boolean;
}

interface ExtendedGraphQLResolveInfo extends GraphQLResolveInfo {
  span?: Span;
}
interface RequestStart {
  request: Request;
  queryString?: string;
  parsedQuery?: DocumentNode;
  operationName?: string;
  variables?: { [key: string]: any };
  persistedQueryHit?: boolean;
  persistedQueryRegister?: boolean;
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

export default class OpentracingExtension<TContext extends SpanContext>
  implements GraphQLExtension<TContext> {
  private serverTracer: Tracer;
  private localTracer: Tracer;
  private requestSpan: Span | null;
  private onFieldResolveFinish?: (
    error: Error | null,
    result: any,
    span: Span
  ) => void;
  private onFieldResolve?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => void;
  private shouldTraceRequest: (info: RequestStart) => boolean;
  private shouldTraceFieldResolver: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => boolean;

  constructor({
    server,
    local,
    shouldTraceRequest,
    shouldTraceFieldResolver,
    onFieldResolveFinish,
    onFieldResolve
  }: InitOptions = {}) {
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
  }

  mapToObj(inputMap: Map<string, any>) {
    let obj: { [key: string]: string } = {};

    inputMap.forEach(function(value, key){
      obj[key] = value
    });

    return obj;
  }

  requestDidStart(infos: RequestStart) {
    if (!this.shouldTraceRequest(infos)) {
      return;
    }

    let headers = infos.request && infos.request.headers
    if (headers && typeof headers.get === 'function') {
      headers = this.mapToObj(infos.request.headers as Map<string, any>)
    }

    const externalSpan =
      infos.request && infos.request.headers
        ? this.serverTracer.extract(
            opentracing.FORMAT_HTTP_HEADERS,
            infos.request.headers
          )
        : undefined;

    const rootSpan = this.serverTracer.startSpan("request", {
      childOf: externalSpan ? externalSpan : undefined
    });

    rootSpan.log({
      queryString: infos.queryString
    });
    this.requestSpan = rootSpan;

    return () => {
      rootSpan.finish();
    };
  }

  willResolveField(
    source: any,
    args: { [argName: string]: any },
    context: TContext,
    info: ExtendedGraphQLResolveInfo
  ) {
    if (
      // we don't trace the request
      !this.requestSpan ||
      // we should not trace this resolver
      !this.shouldTraceFieldResolver(source, args, context, info) ||
      // the previous resolver was not traced
      (info.path && info.path.prev && !context.getSpanByPath(info.path.prev))
    ) {
      return;
    }

    // idempotent method to add helpers to the first context available (which will be propagated by apollo)
    addContextHelpers(context);

    const name = getFieldName(info);
    const parentSpan =
      info.path && info.path.prev
        ? context.getSpanByPath(info.path.prev)
        : this.requestSpan;

    const span = this.localTracer.startSpan(name, {
      childOf: parentSpan || undefined
    });

    context.addSpan(span, info);
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
}
