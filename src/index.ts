import { GraphQLResolveInfo, DocumentNode } from "graphql";
import { GraphQLExtension } from "graphql-extensions";
import { Tracer } from "opentracing";
import { Request } from "apollo-server-env";

interface InitOptions {
  server: Tracer;
  local: Tracer;
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

export default class OpentracingExtension<TContext = any>
  implements GraphQLExtension<TContext> {
  private serverTracer: Tracer;
  // private localTracer: Tracer;
  // private requestSpan: Span | null;

  constructor({ server }: InitOptions) {
    console.log("New Extension initialized");
    // TODO: check for server and local to be present and use smarter defaults
    this.serverTracer = server;
    // this.localTracer = local;
    // this.requestSpan = null;
  }

  requestDidStart(infos: RequestStart) {
    const rootSpan = this.serverTracer.startSpan("request");
    rootSpan.log({
      queryString: infos.queryString
    });
    // this.requestSpan = rootSpan;

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
    console.log("field start", source, args, context, info);

    return (error: Error | null, result: any) => {
      console.log("field end", error, result);
    };
  }
}
