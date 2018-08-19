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
  constructor(_options: InitOptions) {
    // TODO: check for server and local to be present and use smarter defaults
  }

  requestDidStart(infos: RequestStart) {
    console.log("start", infos);
    return () => {
      console.log("end");
    };
  }

  willResolveField(
    source: any,
    args: { [argName: string]: any },
    _context: TContext,
    _info: GraphQLResolveInfo
  ) {
    console.log("field start", source, args);

    return (error: Error | null, result: any) => {
      console.log("field end", error, result);
    };
  }
}
