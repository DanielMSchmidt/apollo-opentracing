import * as opentracing from "opentracing";
import { GraphQLResolveInfo, DocumentNode } from "graphql";
import { GraphQLExtension } from "graphql-extensions";
import { Tracer, Span } from "opentracing";
import { Request } from "apollo-server-env";

const alwaysTrue = () => true;

interface InitOptions {
  server?: Tracer;
  local?: Tracer;
  shouldTraceRequest?: (info: RequestStart) => boolean;
  shouldTraceFieldResolver?: (
    source: any,
    args: { [argName: string]: any },
    context: SpanContext,
    info: GraphQLResolveInfo
  ) => boolean;
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
interface SpanContext {
  span?: Span;
}
export default class OpentracingExtension<TContext extends SpanContext>
  implements GraphQLExtension<TContext> {
  private serverTracer: Tracer;
  private localTracer: Tracer;
  private requestSpan: Span | null;
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
    shouldTraceFieldResolver
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
  }

  requestDidStart(infos: RequestStart) {
    if (!this.shouldTraceRequest(infos)) {
      return;
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
    info: GraphQLResolveInfo
  ) {
    if (
      !this.requestSpan ||
      !this.shouldTraceFieldResolver(source, args, context, info)
    ) {
      return;
    }

    const name = info.fieldName || "field";
    const parentSpan = context.span ? context.span : this.requestSpan;

    const span = this.localTracer.startSpan(name, {
      childOf: parentSpan || undefined
    });

    // There is no nicer way to change the span in the context
    context.span = span;

    return (error: Error | null, result: any) => {
      if (error) {
        span.log({ error: JSON.stringify(error) });
      }
      if (result) {
        span.log({ result: JSON.stringify(result) });
      }
      span.finish();
    };
  }
}
