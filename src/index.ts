import { GraphQLResolveInfo, DocumentNode } from "graphql";
import { GraphQLExtension } from "graphql-extensions";
import { Tracer, Span } from "opentracing";
import { Request } from "apollo-server-env";

const alwaysTrue = () => true;

interface InitOptions {
  server?: Tracer;
  local?: Tracer;
  shouldTraceRequest?: (info: RequestStart) => boolean;
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

  constructor({ server, local, shouldTraceRequest }: InitOptions = {}) {
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
  }

  requestDidStart(infos: RequestStart) {
    if (!this.shouldTraceRequest(infos)) {
      return;
    }

    const rootSpan = this.serverTracer.startSpan("request");
    rootSpan.log({
      queryString: infos.queryString
    });
    this.requestSpan = rootSpan;

    return () => {
      rootSpan.finish();
    };
  }

  willResolveField(
    _source: any,
    _args: { [argName: string]: any },
    context: TContext,
    info: GraphQLResolveInfo
  ) {
    if (!this.requestSpan) {
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
